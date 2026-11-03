import { readFileSync } from "node:fs"
import { join } from "node:path"
import vm from "node:vm"

import { beforeEach, describe, expect, it, vi } from "vitest"

const ORIGEN = "https://app.test"
const CODIGO = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")

function respuesta(
  cuerpo = "ok",
  {
    status = 200,
    type = "basic",
    redirected = false,
    contentType = "text/html; charset=utf-8",
    cabeceras = {} as Record<string, string>,
  } = {},
) {
  const r = new Response(cuerpo, {
    status: status === 0 ? 200 : status,
    headers: { "content-type": contentType, ...cabeceras },
  })
  Object.defineProperties(r, {
    type: { value: type },
    redirected: { value: redirected },
    ok: { value: status >= 200 && status < 300 },
    status: { value: status },
  })
  return r
}

/** Cache Storage en memoria: las claves son rutas relativas o URL absolutas. */
function cacheStorageFalso() {
  const almacen = new Map<string, Map<string, Response>>()
  const clave = (k: string | { url: string }) =>
    new URL(typeof k === "string" ? k : k.url, ORIGEN).href
  const abrir = (nombre: string) => {
    if (!almacen.has(nombre)) almacen.set(nombre, new Map())
    const cache = almacen.get(nombre)!
    return {
      put: async (k: string | { url: string }, r: Response) => void cache.set(clave(k), r),
      match: async (k: string | { url: string }) => cache.get(clave(k))?.clone(),
    }
  }
  return {
    almacen,
    caches: {
      open: async (nombre: string) => abrir(nombre),
      keys: async () => [...almacen.keys()],
      delete: async (nombre: string) => almacen.delete(nombre),
    },
    urls: () => [...almacen.values()].flatMap((c) => [...c.keys()]),
  }
}

type Evento = {
  request?: { url: string; method: string; mode: string }
  data?: unknown
  respondWith: ReturnType<typeof vi.fn>
  waitUntil: ReturnType<typeof vi.fn>
}

function cargarWorker() {
  const oyentes = new Map<string, (evento: Evento) => void>()
  const storage = cacheStorageFalso()
  const red = vi.fn<(destino: unknown, opciones?: unknown) => Promise<Response>>()
  const reloj = { ahora: 1_800_000_000_000 }
  const self = {
    location: new URL(`${ORIGEN}/sw.js`),
    addEventListener: (tipo: string, oyente: (evento: Evento) => void) => oyentes.set(tipo, oyente),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  }
  vm.runInNewContext(CODIGO, {
    self,
    caches: storage.caches,
    fetch: red,
    URL,
    Response,
    Headers,
    Date: { now: () => reloj.ahora },
  })

  async function disparar(tipo: string, datos: Partial<Evento>) {
    const esperas: Promise<unknown>[] = []
    let respondido: Promise<Response> | undefined
    const evento: Evento = {
      ...datos,
      respondWith: vi.fn((r: Promise<Response>) => void (respondido = r)),
      waitUntil: vi.fn((p: Promise<unknown>) => void esperas.push(p)),
    }
    oyentes.get(tipo)!(evento)
    const resultado = respondido ? await respondido : undefined
    await Promise.all(esperas)
    return { evento, resultado }
  }

  const navegar = (ruta: string) =>
    disparar("fetch", { request: { url: `${ORIGEN}${ruta}`, method: "GET", mode: "navigate" } })
  const pedir = (url: string, method = "GET") =>
    disparar("fetch", { request: { url, method, mode: "cors" } })

  const avanzar = (ms: number) => void (reloj.ahora += ms)

  return { storage, red, disparar, navegar, pedir, self, avanzar }
}

let sw: ReturnType<typeof cargarWorker>
const sinRed = () => sw.red.mockRejectedValue(new TypeError("Failed to fetch"))

beforeEach(async () => {
  sw = cargarWorker()
  sw.red.mockImplementation(async () => respuesta("<html>página offline</html>"))
  await sw.disparar("install", {})
  sw.red.mockReset()
})

describe("instalación y activación", () => {
  it("guarda la página sin conexión al instalar", () => {
    expect(sw.storage.urls()).toContain(`${ORIGEN}/offline.html`)
  })

  it("al activar borra las versiones viejas y toma el control", async () => {
    sw.storage.almacen.set("system-solutions-viejo", new Map())
    sw.storage.almacen.set("otra-app", new Map())
    await sw.disparar("activate", {})
    const nombres = [...sw.storage.almacen.keys()]
    expect(nombres).not.toContain("system-solutions-viejo")
    expect(nombres).toContain("otra-app")
    expect(nombres.some((n) => n.startsWith("system-solutions-"))).toBe(true)
    expect(sw.self.clients.claim).toHaveBeenCalled()
  })
})

describe("lo que nunca se intercepta ni se guarda", () => {
  it.each([
    ["POST de la app", `${ORIGEN}/taller`, "POST"],
    ["POST a estáticos", `${ORIGEN}/_next/static/a.js`, "POST"],
    ["Supabase", "https://proyecto.supabase.co/rest/v1/x", "GET"],
    ["Edge Functions", "https://proyecto.supabase.co/functions/v1/x", "GET"],
    ["estático de otro origen", "https://cdn.test/_next/static/a.js", "GET"],
    ["/api", `${ORIGEN}/api/auth/offline-session`, "GET"],
    ["/auth", `${ORIGEN}/auth/callback`, "GET"],
    ["payload RSC de taller", `${ORIGEN}/taller?_rsc=abc`, "GET"],
  ])("%s", async (_nombre, url, metodo) => {
    const antes = sw.storage.urls().length
    const { evento } = await sw.pedir(url, metodo)
    expect(evento.respondWith).not.toHaveBeenCalled()
    expect(sw.storage.urls()).toHaveLength(antes)
  })

  it("navegar a /api o /auth tampoco pasa por el worker", async () => {
    for (const ruta of ["/api/x", "/auth/callback", "/auth"]) {
      const { evento } = await sw.navegar(ruta)
      expect(evento.respondWith).not.toHaveBeenCalled()
    }
  })
})

describe("estáticos", () => {
  it.each(["/_next/static/chunks/a.js", "/icons/icon-192.png"])(
    "%s se sirve desde el cache después de la primera vez",
    async (ruta) => {
      sw.red.mockResolvedValue(respuesta("binario", { contentType: "text/javascript" }))
      const primera = await sw.pedir(`${ORIGEN}${ruta}`)
      await expect(primera.resultado!.text()).resolves.toBe("binario")
      sinRed()
      const segunda = await sw.pedir(`${ORIGEN}${ruta}`)
      await expect(segunda.resultado!.text()).resolves.toBe("binario")
      expect(sw.red).toHaveBeenCalledOnce()
    },
  )

  it("no guarda un estático con error", async () => {
    sw.red.mockResolvedValue(respuesta("no", { status: 404 }))
    await sw.pedir(`${ORIGEN}/_next/static/falta.js`)
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/_next/static/falta.js`)
  })
})

describe("navegación", () => {
  it("en /taller usa primero la red y guarda el HTML", async () => {
    sw.red.mockResolvedValue(respuesta("<html>taller nuevo</html>"))
    const { resultado } = await sw.navegar("/taller")
    await expect(resultado!.text()).resolves.toContain("taller nuevo")
    expect(sw.storage.urls()).toContain(`${ORIGEN}/taller`)
  })

  it("sin conexión sirve el HTML de /taller ya visitado", async () => {
    sw.red.mockResolvedValue(respuesta("<html>taller</html>"))
    await sw.navegar("/taller/sincronizacion")
    sinRed()
    const { resultado } = await sw.navegar("/taller/sincronizacion")
    await expect(resultado!.text()).resolves.toContain("taller")
  })

  it("sin conexión ignora la query para encontrar el HTML de la misma ruta", async () => {
    sw.red.mockResolvedValue(respuesta("<html>taller</html>"))
    await sw.navegar("/taller")
    sinRed()
    const { resultado } = await sw.navegar("/taller?visita=1")
    await expect(resultado!.text()).resolves.toContain("taller")
  })

  it("una ruta de taller nunca visitada cae en la página sin conexión", async () => {
    sinRed()
    const { resultado } = await sw.navegar("/taller/sincronizacion")
    await expect(resultado!.text()).resolves.toContain("página offline")
  })

  it.each([
    "/tallerista",
    "/admin",
    "/admin/taller",
    "/portal",
    "/superadmin",
    "/cuenta/seguridad",
    "/login",
  ])("%s no guarda HTML y sin conexión muestra la página sin conexión", async (ruta) => {
    sw.red.mockResolvedValue(respuesta("<html>privado</html>"))
    await sw.navegar(ruta)
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}${ruta}`)
    sinRed()
    const { resultado } = await sw.navegar(ruta)
    await expect(resultado!.text()).resolves.toContain("página offline")
  })

  it("no guarda respuestas de /taller que no sean HTML correcto", async () => {
    for (const r of [
      respuesta("error", { status: 500 }),
      respuesta("x", { redirected: true }),
      respuesta("x", { type: "opaqueredirect", status: 0 }),
      respuesta("{}", { contentType: "application/json" }),
      // El proxy reescribe /taller a /sin-acceso para otros roles, con estado 200.
      respuesta("<html>sin acceso</html>", {
        cabeceras: { "x-middleware-rewrite": "/sin-acceso" },
      }),
    ]) {
      sw.red.mockResolvedValueOnce(r)
      await sw.navegar("/taller")
      expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
    }
  })

  it("si el servidor redirige /taller, la sesión terminó y se borra el HTML guardado", async () => {
    sw.red.mockResolvedValueOnce(respuesta("<html>taller</html>"))
    await sw.navegar("/taller")
    sw.red.mockResolvedValueOnce(respuesta("", { type: "opaqueredirect", status: 0 }))
    await sw.navegar("/taller")
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
  })

  it("la raíz sin conexión lleva a /taller solo si hay HTML guardado", async () => {
    sinRed()
    const sinGuardar = await sw.navegar("/")
    await expect(sinGuardar.resultado!.text()).resolves.toContain("página offline")

    sw.red.mockResolvedValueOnce(respuesta("<html>taller</html>"))
    await sw.navegar("/taller")
    sinRed()
    const { resultado } = await sw.navegar("/")
    expect(resultado!.status).toBe(302)
    expect(resultado!.headers.get("location")).toBe(`${ORIGEN}/taller`)
  })
})

describe("fin de sesión", () => {
  beforeEach(async () => {
    sw.red.mockImplementation(async () => respuesta("<html>taller</html>"))
    await sw.navegar("/taller")
    await sw.pedir(`${ORIGEN}/_next/static/a.js`)
    sw.red.mockReset()
  })

  it("el mensaje borra el HTML de taller y conserva los estáticos", async () => {
    await sw.disparar("message", { data: { tipo: "limpiar-html-taller" } })
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
    expect(sw.storage.urls()).toContain(`${ORIGEN}/_next/static/a.js`)
    sinRed()
    const { resultado } = await sw.navegar("/taller")
    await expect(resultado!.text()).resolves.toContain("página offline")
  })

  it("el DELETE del ticket offline borra el HTML aunque no haya red, sin interceptar el pedido", async () => {
    const { evento } = await sw.pedir(`${ORIGEN}/api/auth/offline-session`, "DELETE")
    expect(evento.respondWith).not.toHaveBeenCalled()
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
  })

  it("ignora mensajes desconocidos", async () => {
    await sw.disparar("message", { data: { tipo: "otra-cosa" } })
    await sw.disparar("message", { data: null })
    expect(sw.storage.urls()).toContain(`${ORIGEN}/taller`)
  })
})

describe("sembrado de la primera visita", () => {
  it("guarda solo estáticos propios y HTML de taller que falte", async () => {
    sw.red.mockImplementation(async () => respuesta("<html>x</html>"))
    await sw.disparar("message", {
      data: {
        tipo: "sembrar-taller",
        urls: [
          `${ORIGEN}/_next/static/a.js`,
          `${ORIGEN}/taller`,
          `${ORIGEN}/admin`,
          `${ORIGEN}/api/secreto`,
          "https://proyecto.supabase.co/_next/static/b.js",
          123,
        ],
      },
    })
    const urls = sw.storage.urls()
    expect(urls).toContain(`${ORIGEN}/_next/static/a.js`)
    expect(urls).toContain(`${ORIGEN}/taller`)
    expect(urls).not.toContain(`${ORIGEN}/admin`)
    expect(urls).not.toContain(`${ORIGEN}/api/secreto`)
    expect(urls.some((u) => u.includes("supabase"))).toBe(false)
    expect(sw.red).toHaveBeenCalledTimes(2)
  })

  it("guarda también los estáticos que referencia el HTML sembrado", async () => {
    sw.red.mockImplementation(async (destino) =>
      String(destino).endsWith("/taller/sincronizacion")
        ? respuesta(
            `<script src="/_next/static/chunks/pantalla.js" async></script>
             <script>self.__next_f.push([1,"[\\"/_next/static/chunks/diferido.js\\"]"])</script>`,
          )
        : respuesta("binario", { contentType: "text/javascript" }),
    )
    await sw.disparar("message", {
      data: { tipo: "sembrar-taller", urls: [`${ORIGEN}/taller/sincronizacion`] },
    })
    const urls = sw.storage.urls()
    expect(urls).toContain(`${ORIGEN}/taller/sincronizacion`)
    expect(urls).toContain(`${ORIGEN}/_next/static/chunks/pantalla.js`)
    expect(urls).toContain(`${ORIGEN}/_next/static/chunks/diferido.js`)
  })

  it("no guarda una redirección", async () => {
    sw.red.mockResolvedValueOnce(respuesta("<html>x</html>", { redirected: true }))
    await sw.disparar("message", { data: { tipo: "sembrar-taller", urls: [`${ORIGEN}/taller`] } })
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
  })

  it("vuelve a pedir el HTML ya guardado, pero no los estáticos", async () => {
    sw.red.mockImplementation(async () => respuesta("<html>x</html>"))
    const urls = [`${ORIGEN}/taller`, `${ORIGEN}/_next/static/a.js`]
    await sw.disparar("message", { data: { tipo: "sembrar-taller", urls } })
    sw.red.mockClear()
    await sw.disparar("message", { data: { tipo: "sembrar-taller", urls } })
    expect(sw.red).toHaveBeenCalledOnce()
    expect(sw.red).toHaveBeenCalledWith(`${ORIGEN}/taller`)
  })

  it("una falla de red al sembrar no rompe el worker", async () => {
    sinRed()
    await expect(
      sw.disparar("message", { data: { tipo: "sembrar-taller", urls: [`${ORIGEN}/taller`] } }),
    ).resolves.toBeDefined()
  })
})

describe("vigencia de 12 horas sin conexión (ADR 0009)", () => {
  const HORA = 3_600_000
  const DOCE_HORAS = 12 * HORA
  const HTML_TALLER = "<html>taller</html>"

  const guardarEnLinea = async (ruta = "/taller") => {
    sw.red.mockResolvedValueOnce(respuesta(HTML_TALLER))
    await sw.navegar(ruta)
  }
  const textoSinRed = async (ruta = "/taller") => {
    sinRed()
    const { resultado } = await sw.navegar(ruta)
    return resultado!.text()
  }
  const nombreCacheHtml = () =>
    [...sw.storage.almacen.keys()].find((nombre) => nombre.includes("html-taller"))!

  it("los caches pasan a la versión v2", async () => {
    await guardarEnLinea()
    await sw.disparar("activate", {})
    const nombres = [...sw.storage.almacen.keys()]
    expect(nombres.length).toBeGreaterThan(0)
    expect(nombres.every((nombre) => nombre.endsWith("-v2"))).toBe(true)
  })

  it("sirve una entrada con apenas menos de 12 horas", async () => {
    await guardarEnLinea()
    sw.avanzar(DOCE_HORAS - 1)
    await expect(textoSinRed()).resolves.toBe(HTML_TALLER)
  })

  it("rechaza una entrada con apenas más de 12 horas y borra todo el HTML de taller", async () => {
    await guardarEnLinea()
    await guardarEnLinea("/taller/sincronizacion")
    sw.avanzar(DOCE_HORAS + 1)
    await expect(textoSinRed()).resolves.toContain("página offline")
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller/sincronizacion`)
    expect(sw.storage.urls()).toContain(`${ORIGEN}/offline.html`)
  })

  it("la raíz no redirige a una entrada vencida y la borra", async () => {
    await guardarEnLinea()
    sw.avanzar(DOCE_HORAS + 1)
    sinRed()
    const { resultado } = await sw.navegar("/")
    expect(resultado!.status).not.toBe(302)
    await expect(resultado!.text()).resolves.toContain("página offline")
    expect(sw.storage.urls()).not.toContain(`${ORIGEN}/taller`)
  })

  it("la raíz redirige a una entrada todavía vigente", async () => {
    await guardarEnLinea()
    sw.avanzar(DOCE_HORAS - 1)
    sinRed()
    const { resultado } = await sw.navegar("/")
    expect(resultado!.status).toBe(302)
  })

  it("una navegación en línea correcta renueva la vigencia", async () => {
    await guardarEnLinea()
    sw.avanzar(11 * HORA)
    await guardarEnLinea()
    sw.avanzar(11 * HORA)
    await expect(textoSinRed()).resolves.toBe(HTML_TALLER)
  })

  it("una navegación en línea con error no renueva la vigencia", async () => {
    await guardarEnLinea()
    sw.avanzar(11 * HORA)
    sw.red.mockResolvedValueOnce(respuesta("error", { status: 500 }))
    await sw.navegar("/taller")
    sw.avanzar(2 * HORA)
    await expect(textoSinRed()).resolves.toContain("página offline")
  })

  it("el sembrado renueva la vigencia al volver a pedir el HTML", async () => {
    await guardarEnLinea("/taller/sincronizacion")
    sw.avanzar(11 * HORA)
    sw.red.mockResolvedValueOnce(respuesta(HTML_TALLER))
    await sw.disparar("message", {
      data: { tipo: "sembrar-taller", urls: [`${ORIGEN}/taller/sincronizacion`] },
    })
    sw.avanzar(11 * HORA)
    await expect(textoSinRed("/taller/sincronizacion")).resolves.toBe(HTML_TALLER)
  })

  it("una falla de red al sembrar no renueva la vigencia ni borra la entrada", async () => {
    await guardarEnLinea()
    sw.avanzar(11 * HORA)
    sinRed()
    await sw.disparar("message", { data: { tipo: "sembrar-taller", urls: [`${ORIGEN}/taller`] } })
    expect(sw.storage.urls()).toContain(`${ORIGEN}/taller`)
    sw.avanzar(2 * HORA)
    await expect(textoSinRed()).resolves.toContain("página offline")
  })

  it("rechaza una entrada sin marca de tiempo", async () => {
    await guardarEnLinea()
    const cache = await sw.storage.caches.open(nombreCacheHtml())
    await cache.put("/taller", respuesta(HTML_TALLER))
    await expect(textoSinRed()).resolves.toContain("página offline")
  })

  it("rechaza una entrada guardada en el futuro: el reloj del dispositivo retrocedió", async () => {
    await guardarEnLinea()
    sw.avanzar(-HORA)
    await expect(textoSinRed()).resolves.toContain("página offline")
  })

  it("la marca no altera el cuerpo, el content-type ni la respuesta en línea", async () => {
    sw.red.mockResolvedValueOnce(respuesta(HTML_TALLER, { cabeceras: { vary: "rsc" } }))
    const { resultado: enLinea } = await sw.navegar("/taller")
    expect([...enLinea!.headers.keys()].sort()).toEqual(["content-type", "vary"])
    await expect(enLinea!.text()).resolves.toBe(HTML_TALLER)

    sinRed()
    const { resultado: guardada } = await sw.navegar("/taller")
    expect(guardada!.status).toBe(200)
    expect(guardada!.headers.get("content-type")).toBe("text/html; charset=utf-8")
    expect(guardada!.headers.get("vary")).toBe("rsc")
    await expect(guardada!.text()).resolves.toBe(HTML_TALLER)
  })
})
