import { edge, edgeCrudo, sql, tokenDe } from "../support/api"
import { certificadoDeValvula, visitaAceptada, type VisitaProgramada } from "../support/datos"
import { guardarEstado, leerEstado } from "../support/estado"
import { expect, test } from "../support/fixtures"
import { fechaArgentina, leerSemilla } from "../support/semilla"
import { capturarYCerrar, REGEX_UUID } from "../support/taller"

type Vencido = VisitaProgramada & { certificadoId: string }

test.describe("Filtros de Parte Diario", () => {
  test("RF-33 RF-45 CA-08 CA-14: Administrador y Cliente filtran certificados por Parte Diario", async ({ abrir }) => {
    const pd = `PD${Date.now() % 1000000}`
    const conPd = await visitaAceptada(1)
    const sinPd = await visitaAceptada(1)
    const taller = await abrir("taller", { viewport: "tablet" })
    await capturarYCerrar(taller.page, conPd.visitaId, conPd.valvulas[0].tag, { representante: "Juan Pérez", pd })
    await capturarYCerrar(taller.page, sinPd.visitaId, sinPd.valvulas[0].tag, { representante: "Juan Pérez" })

    await test.step("Administrador", async () => {
      const { page } = await abrir("admin")
      await page.goto("/admin/certificados")
      await page.getByLabel(/Parte Diario/).fill(pd)
      await page.getByRole("button", { name: "Aplicar filtros" }).click()
      await expect(page.getByRole("cell", { name: pd }).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole("cell", { name: conPd.valvulas[0].tag })).toBeVisible()
      await expect(page.getByRole("cell", { name: sinPd.valvulas[0].tag })).toHaveCount(0)
    })

    await test.step("Cliente", async () => {
      const { page } = await abrir("cliente")
      await page.goto("/portal/certificados")
      await expect(page.getByRole("row").filter({ hasText: sinPd.valvulas[0].tag })).toBeVisible({ timeout: 45_000 })
      await page.getByPlaceholder(/Parte Diario|PD1234/).fill(pd)
      await expect(page.getByRole("row").filter({ hasText: conPd.valvulas[0].tag })).toBeVisible()
      await expect(page.getByRole("row").filter({ hasText: sinPd.valvulas[0].tag })).toHaveCount(0)
    })
  })
})

test.describe("RN-06: certificado vencido", () => {
  test("RN-01 RN-08: un certificado con ejecución de hace más de un año queda vencido", async ({ abrir }) => {
    const visita = await visitaAceptada(1)
    const { page } = await abrir("taller", { viewport: "tablet" })
    const fechaVieja = `${Number(fechaArgentina().slice(0, 4)) - 2}-03-15`
    await capturarYCerrar(page, visita.visitaId, visita.valvulas[0].tag, {
      representante: "Juan Pérez",
      fecha: fechaVieja,
    })
    const certificadoId = certificadoDeValvula(visita.visitaId, visita.valvulas[0].id)
    expect(sql(`select vigencia_hasta < now() from public.certificados where id = '${certificadoId}'`)).toBe("t")
    guardarEstado("vencido", { ...visita, certificadoId } satisfies Vencido)
  })

  test("RN-06 CA-06: en el portal el vencido figura como tal y no se puede abrir", async ({ abrir }) => {
    const vencido = leerEstado<Vencido>("vencido")
    const { page } = await abrir("cliente")
    await page.goto("/portal/certificados")
    const fila = page.getByRole("row").filter({ hasText: vencido.valvulas[0].tag })
    await expect(fila).toBeVisible({ timeout: 45_000 })
    await expect(fila).toContainText("Vencido")
    await expect(fila.getByRole("link", { name: "Ver certificado" })).toHaveCount(0)
  })

  test("RN-06 CA-06: el Cliente no ve el documento vencido entrando por la URL directa", async ({ abrir }) => {
    const vencido = leerEstado<Vencido>("vencido")
    const { page } = await abrir("cliente")
    await page.goto(`/portal/certificados/${vencido.certificadoId}?valvula=${vencido.valvulas[0].id}`)
    await expect(page.getByText(/venc/i).first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("region", { name: "Vista del certificado" })).toHaveCount(0)
  })

  test("RN-06 CA-06 RNF-01: el servidor rechaza entregar al Cliente un certificado vencido", async () => {
    const vencido = leerEstado<Vencido>("vencido")
    const respuesta = await edgeCrudo("cliente", "certificate-field", `certificates/${vencido.certificadoId}/download`)
    expect(respuesta.status).toBeLessThan(500)
    expect(respuesta.status).toBeGreaterThanOrEqual(400)
  })

  test("RN-05 RF-29: el Administrador sigue accediendo al certificado vencido", async ({ abrir }) => {
    const vencido = leerEstado<Vencido>("vencido")
    const { page } = await abrir("admin")
    await page.goto(`/admin/certificados/${vencido.certificadoId}`)
    await expect(page.getByRole("region", { name: "Vista del certificado" })).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("button", { name: /Descargar PDF/ })).toBeEnabled()
  })
})

test.describe("Alcance del Cliente y de los roles", () => {
  test("RN-09 RF-05 RNF-01 CA-06: un Cliente no accede a los yacimientos de otro Cliente", async () => {
    const { yacimientoOtroClienteId, valvulaOtroClienteId } = leerSemilla()
    const arbol = await edgeCrudo("cliente", "asset-access", `yacimientos/${yacimientoOtroClienteId}/hierarchy`)
    expect(arbol.status).toBeGreaterThanOrEqual(400)
    const historial = await edgeCrudo("cliente", "certificate-field", `valves/${valvulaOtroClienteId}/certificates`)
    expect(historial.status).toBeGreaterThanOrEqual(400)
  })

  test("RN-09 ADR-0001: el Cliente ve su yacimiento completo", async () => {
    const { yacimientoId } = leerSemilla()
    const yacimientos = await edge<{ id: string }[]>("cliente", "asset-access", "yacimientos")
    expect(yacimientos.map((y) => y.id)).toContain(yacimientoId)
  })

  test("RF-36: el Cliente no puede crear solicitudes de servicio", async () => {
    const { yacimientoId, plantaId } = leerSemilla()
    const respuesta = await edgeCrudo("cliente", "service-workflow", "requests", {
      method: "POST",
      body: { yacimiento_id: yacimientoId, selections: [{ kind: "planta", id: plantaId }] },
    })
    expect(respuesta.status).toBeLessThan(500)
    // N4: la pantalla no lo ofrece, pero el backend lo autoriza al Cliente dueño del yacimiento.
    test.fail(true, "N4: RF-36 la API permite al Cliente crear solicitudes")
    expect(respuesta.status).toBeGreaterThanOrEqual(400)
  })

  test("RF-36: el portal no ofrece solicitar turnos", async ({ abrir }) => {
    const { page } = await abrir("cliente")
    await page.goto("/portal/turnos")
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("button", { name: /Solicitar|Nueva tarea|Nuevo turno/i })).toHaveCount(0)
  })

  test("RF-46 ADR-0014 RF-37: el backup masivo es solo del Súper Administrador", async ({ abrir }) => {
    // Cuerpo válido (`scope`/`from`/`to`): con `desde` la función rechazaba la forma (400) antes de
    // llegar al control de rol, y la prueba no medía el permiso.
    const admin = await edgeCrudo("admin", "backup-export", "backups", {
      method: "POST",
      body: { scope: "date_range", from: "2020-01-01", to: "2020-01-02" },
    })
    expect(admin.status).toBe(403)
    const { page } = await abrir("super")
    await page.goto("/superadmin/backups")
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("button", { name: /Generar|Descargar|backup/i }).first()).toBeVisible()
  })

  test("RNF-02: la API exige token: sin sesión no entrega datos", async () => {
    const { SUPABASE_URL, PUBLISHABLE_KEY } = await import("../support/entorno")
    expect(await tokenDe("admin")).toBeTruthy()
    const respuesta = await fetch(`${SUPABASE_URL}/functions/v1/service-workflow/visits`, {
      headers: { apikey: PUBLISHABLE_KEY },
    })
    expect(respuesta.status).toBe(401)
  })

  test("RN-14 RF-41 ADR-0005: un certificado finalizado es inmutable para el Taller", async () => {
    const vencido = leerEstado<Vencido>("vencido")
    const respuesta = await edgeCrudo("taller", "certificate-field", `certificates/${vencido.certificadoId}`, {
      method: "PATCH",
      body: { observaciones: "Intento de corrección" },
    })
    expect(respuesta.status).toBeGreaterThanOrEqual(400)
    expect(respuesta.status).toBeLessThan(500)
  })
})

test.describe("Protección de /reset-password", () => {
  test("RNF-03: sin enlace de recuperación ni sesión, /reset-password no permite cambiar la contraseña", async ({
    abrir,
  }) => {
    const { page } = await abrir("admin", { iniciarSesion: false })
    await page.goto("/reset-password")
    await expect(page.getByText(/enlace venció o ya fue usado/)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test("RNF-03: con una sesión normal, /reset-password pide confirmar antes de cambiar la contraseña", async ({
    abrir,
  }) => {
    const { page } = await abrir("admin")
    await page.goto("/reset-password")
    await expect(page.getByText(/Confirmá que querés cambiar la contraseña de/)).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })
})

test.describe("Historial y portal sin datos crudos", () => {
  test("RF-33 CA-08: el historial de certificados no muestra fechas ISO ni identificadores [D13]", async ({ abrir }) => {
    const { page } = await abrir("admin")
    await page.goto("/admin/certificados")
    await expect(page.getByRole("button", { name: "Aplicar filtros" })).toBeVisible({ timeout: 45_000 })
    const tabla = page.getByRole("table").first()
    await expect(tabla).toBeVisible({ timeout: 45_000 })
    const texto = await tabla.innerText()
    expect(texto).not.toMatch(REGEX_UUID)
    expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  test("RF-35: /portal/empresa no provoca errores de permiso [D13]", async ({ abrir }) => {
    const { page, problemas } = await abrir("cliente")
    await page.goto("/portal/empresa")
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 45_000 })
    await page.waitForLoadState("networkidle")
    expect(problemas.respuestas.filter((r) => r.status === 403)).toEqual([])
  })

  test("RNF-05 RF-33: /portal/certificados pide el historial de las Válvulas en lote, no uno por Válvula", async ({
    abrir,
  }) => {
    const { page, problemas } = await abrir("cliente")
    const historiales: string[] = []
    page.on("request", (pedido) => {
      const ruta = new URL(pedido.url()).pathname
      if (/\/certificate-field\/(valves\/[^/]+\/certificates|certificates\/valve-histories)$/.test(ruta))
        historiales.push(ruta.replace(/.*certificate-field\//, ""))
    })
    await page.goto("/portal/certificados")
    await expect(page.getByRole("link", { name: "Ver certificado" }).first()).toBeVisible({ timeout: 45_000 })
    await page.waitForLoadState("networkidle")
    // La suite deja decenas de Válvulas en el yacimiento del Cliente (más de 100 si la base no se
    // reinicia entre corridas): se piden en lotes de VALVULAS_POR_LOTE, nunca una por Válvula.
    expect(historiales.length).toBeGreaterThan(0)
    expect(historiales.filter((ruta) => ruta !== "certificates/valve-histories")).toEqual([])
    expect(historiales.length).toBeLessThanOrEqual(5)
    expect(problemas.respuestas).toEqual([])
  })
})
