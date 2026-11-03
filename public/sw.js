// Service worker de System Solutions. Solo guarda lo que el Taller Móvil necesita para abrir sin
// conexión (ADR 0009): nunca datos ni HTML autenticado de otros roles. Los pedidos que no entran
// en un `respondWith` siguen directo a la red. Subir VERSION cuando cambie esta política.

const VERSION = "v2"
const PREFIJO = "system-solutions-"
const CACHE_ESTATICOS = `${PREFIJO}estaticos-${VERSION}`
const CACHE_HTML_TALLER = `${PREFIJO}html-taller-${VERSION}`
const CACHE_OFFLINE = `${PREFIJO}offline-${VERSION}`
const CACHES_VIGENTES = [CACHE_ESTATICOS, CACHE_HTML_TALLER, CACHE_OFFLINE]

const PAGINA_OFFLINE = "/offline.html"
const RUTA_TALLER = "/taller"
// `cerrar` en auth-provider.tsx siempre manda este DELETE, también cuando no hay red.
const RUTA_TICKET_OFFLINE = "/api/auth/offline-session"
// Mismo límite que OFFLINE_SESSION_TTL_SECONDS: el ticket HttpOnly solo lo puede validar el servidor,
// así que sin red lo hace cumplir el worker con la hora en que guardó cada entrada.
const VIGENCIA_SIN_CONEXION_MS = 12 * 60 * 60 * 1000
const CABECERA_GUARDADO_EN = "x-system-solutions-guardado-en"
// Las respuestas de Next varían por cabeceras RSC que una navegación no repite.
const SIN_VARY = { ignoreVary: true }

const bajoRuta = (pathname, ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`)
const esRutaTaller = (pathname) => bajoRuta(pathname, RUTA_TALLER)
const esRutaExcluida = (pathname) => bajoRuta(pathname, "/api") || bajoRuta(pathname, "/auth")
const esEstatico = (pathname) =>
  pathname.startsWith("/_next/static/") || pathname.startsWith("/icons/")

const esGuardable = (respuesta) =>
  respuesta.status === 200 && respuesta.type === "basic" && !respuesta.redirected

// El proxy reescribe /taller a /sin-acceso para otros roles, con estado 200.
const esHtmlTaller = (respuesta) =>
  esGuardable(respuesta) &&
  (respuesta.headers.get("content-type") ?? "").includes("text/html") &&
  !respuesta.headers.has("x-middleware-rewrite")

const borrarHtmlTaller = () => caches.delete(CACHE_HTML_TALLER)

async function guardarHtmlTaller(pathname, respuesta) {
  const headers = new Headers(respuesta.headers)
  headers.set(CABECERA_GUARDADO_EN, String(Date.now()))
  const sellada = new Response(await respuesta.arrayBuffer(), {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers,
  })
  const cache = await caches.open(CACHE_HTML_TALLER)
  await cache.put(pathname, sellada)
}

// Una respuesta en línea renueva la entrada; si el proxy redirige /taller, la sesión terminó.
function actualizarHtmlTaller(pathname, respuesta) {
  if (esHtmlTaller(respuesta)) return guardarHtmlTaller(pathname, respuesta.clone())
  if (respuesta.redirected || respuesta.type === "opaqueredirect") return borrarHtmlTaller()
  return Promise.resolve()
}

// Una entrada vencida borra todo el HTML. Sin marca o con hora futura (el reloj del dispositivo
// retrocedió) no se puede probar la vigencia, así que también cuenta como vencida.
async function htmlTallerVigente(pathname) {
  const cache = await caches.open(CACHE_HTML_TALLER)
  const guardada = await cache.match(pathname, SIN_VARY)
  if (!guardada) return undefined
  const edad = Date.now() - Number(guardada.headers.get(CABECERA_GUARDADO_EN))
  if (edad >= 0 && edad < VIGENCIA_SIN_CONEXION_MS) return guardada
  await borrarHtmlTaller()
  return undefined
}

async function primeroCache(url, request) {
  const cache = await caches.open(CACHE_ESTATICOS)
  const guardada = await cache.match(url.href, SIN_VARY)
  if (guardada) return guardada
  const respuesta = await fetch(request)
  if (esGuardable(respuesta)) await cache.put(url.href, respuesta.clone())
  return respuesta
}

async function respaldoSinConexion(url) {
  if (esRutaTaller(url.pathname)) {
    const guardada = await htmlTallerVigente(url.pathname)
    if (guardada) return guardada
  } else if (url.pathname === "/" && (await htmlTallerVigente(RUTA_TALLER))) {
    // La app instalada arranca en "/", que el proxy resuelve por rol y sin red no puede.
    return Response.redirect(new URL(RUTA_TALLER, self.location.origin).href, 302)
  }
  const offline = await caches.open(CACHE_OFFLINE)
  return (await offline.match(PAGINA_OFFLINE)) ?? Response.error()
}

async function navegar(event, url) {
  let respuesta
  try {
    respuesta = await fetch(event.request)
  } catch {
    return respaldoSinConexion(url)
  }
  if (esRutaTaller(url.pathname)) event.waitUntil(actualizarHtmlTaller(url.pathname, respuesta))
  return respuesta
}

const sembrarEstatico = (url) => primeroCache(url, url.href)

// Siempre vuelve a pedir el HTML: una entrada que no se renueva junto con las demás vencería antes
// y, al vencer, borraría también las que siguen vigentes.
async function sembrarHtmlTaller(url) {
  const respuesta = await fetch(url.href)
  await actualizarHtmlTaller(url.pathname, respuesta)
  if (!esHtmlTaller(respuesta)) return
  const html = await respuesta.text()
  // Los chunks de una pantalla no visitada todavía no pasaron por el worker: sin ellos el HTML
  // guardado no llega a hidratar.
  const rutas = new Set(html.match(/\/_next\/static\/[^"'\\\s<>)]+/g) ?? [])
  await Promise.allSettled(
    [...rutas].map((ruta) => sembrarEstatico(new URL(ruta, self.location.origin))),
  )
}

async function sembrarUrl(texto) {
  const url = new URL(texto)
  if (url.origin !== self.location.origin || esRutaExcluida(url.pathname)) return
  if (esEstatico(url.pathname)) await sembrarEstatico(url)
  else if (esRutaTaller(url.pathname)) await sembrarHtmlTaller(url)
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const respuesta = await fetch(PAGINA_OFFLINE)
      if (!esGuardable(respuesta)) throw new Error("No se pudo guardar la página sin conexión")
      const cache = await caches.open(CACHE_OFFLINE)
      await cache.put(PAGINA_OFFLINE, respuesta)
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const nombres = await caches.keys()
      await Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith(PREFIJO) && !CACHES_VIGENTES.includes(nombre))
          .map((nombre) => caches.delete(nombre)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.method === "DELETE" && url.pathname === RUTA_TICKET_OFFLINE) {
    event.waitUntil(borrarHtmlTaller())
    return
  }
  if (request.method !== "GET" || esRutaExcluida(url.pathname)) return
  if (request.mode === "navigate") {
    event.respondWith(navegar(event, url))
  } else if (esEstatico(url.pathname)) {
    event.respondWith(primeroCache(url, request))
  }
})

self.addEventListener("message", (event) => {
  const { tipo, urls } = event.data ?? {}
  if (tipo === "limpiar-html-taller") {
    event.waitUntil(borrarHtmlTaller())
  } else if (tipo === "sembrar-taller" && Array.isArray(urls)) {
    const validas = urls.filter((url) => typeof url === "string")
    event.waitUntil(Promise.allSettled(validas.map(sembrarUrl)))
  }
})
