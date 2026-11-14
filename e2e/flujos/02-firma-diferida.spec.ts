import { vistaCertificado } from "../support/admin"
import { sql } from "../support/api"
import { certificadoDeValvula, visitaAceptada, type VisitaProgramada } from "../support/datos"
import { guardarEstado, leerEstado } from "../support/estado"
import { expect, test } from "../support/fixtures"
import { archivoPng, capturarYCerrar } from "../support/taller"

type Flujo2 = VisitaProgramada & { certificadoId: string }

const HORARIO = "08:23"
const FIRMANTE = "Carla Cliente"

const urlPortal = (flujo: Flujo2) =>
  `/portal/certificados/${flujo.certificadoId}?valvula=${flujo.valvulas[0].id}`

test.describe("Flujo 2: firma diferida del Cliente", () => {
  test("RF-23 RF-25: el Taller cierra la visita sin representante presente", async ({ abrir }) => {
    const visita = await visitaAceptada(1, { horario: HORARIO })
    const { page } = await abrir("taller", { viewport: "tablet" })
    await capturarYCerrar(page, visita.visitaId, visita.valvulas[0].tag)
    guardarEstado("flujo2", {
      ...visita,
      certificadoId: certificadoDeValvula(visita.visitaId, visita.valvulas[0].id),
    } satisfies Flujo2)
  })

  test("RN-04 RF-28 CA-05: el Cliente abre el certificado pendiente de firma [D6]", async ({ abrir }) => {
    const flujo = leerEstado<Flujo2>("flujo2")
    const { page } = await abrir("cliente")
    await page.goto(urlPortal(flujo))
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 45_000 })
    await expect(vistaCertificado(page)).toBeVisible({ timeout: 10_000 })
  })

  test("RN-04 RF-28 CA-05: sin firma del Cliente, ve la marca REQUIERE FIRMA y no puede descargar (D6 aislado)", async ({
    abrir,
  }) => {
    const flujo = leerEstado<Flujo2>("flujo2")
    const { page, context } = await abrir("cliente")
    // Solo en este navegador y solo en la respuesta: deja ver el comportamiento detrás de D6 sin
    // tocar código ni base. El marcador de la prueba anterior sigue exigiendo el arreglo real.
    await context.route("**/functions/v1/certificate-field/valves/*/certificates", async (route) => {
      const respuesta = await route.fetch()
      const cuerpo = (await respuesta.text()).replaceAll('"is_current":null', '"is_current":false')
      await route.fulfill({ response: respuesta, body: cuerpo })
    })
    await page.goto(urlPortal(flujo))
    await expect(vistaCertificado(page)).toBeVisible({ timeout: 45_000 })
    await expect(vistaCertificado(page).getByText("REQUIERE FIRMA").first()).toBeVisible()
    await expect(page.getByRole("button", { name: /Descargar PDF/ })).toBeDisabled()
    expect(await vistaCertificado(page).innerText()).not.toMatch(/CERTIFICADO #:\s*\d{2}-\d{2}-\d{4}/)
  })

  test("RN-12 RF-26: sin ambas firmas el certificado todavía no tiene número", () => {
    const flujo = leerEstado<Flujo2>("flujo2")
    expect(sql(`select coalesce(numero::text, 'sin-numero') from public.certificados where id = '${flujo.certificadoId}'`)).toBe(
      "sin-numero",
    )
  })

  test("RN-05 RF-29 CA-05: el Administrador puede descargar aunque falte la firma del Cliente", async ({
    abrir,
  }) => {
    const flujo = leerEstado<Flujo2>("flujo2")
    const { page } = await abrir("admin")
    await page.goto(`/admin/certificados/${flujo.certificadoId}`)
    await expect(vistaCertificado(page)).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole("button", { name: /Descargar PDF/ })).toBeEnabled()
    await page.emulateMedia({ media: "print" })
    const pdf = await page.pdf({ format: "A4" })
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
  })

  test("RF-35 RN-04: el portal lista el certificado pendiente de firma [D6]", async ({ abrir }) => {
    const flujo = leerEstado<Flujo2>("flujo2")
    const { page } = await abrir("cliente")
    await page.goto("/portal/certificados")
    await expect(page.getByRole("heading", { name: "Certificados pendientes de firma" }).or(page.getByText("Certificado pendiente").first())).toBeVisible({
      timeout: 45_000,
    })
    await expect(page.getByText(flujo.valvulas[0].tag).first()).toBeVisible({ timeout: 10_000 })
  })

  test("RF-23 RN-04 RF-28 CA-05: el Cliente sube su firma y queda número, sin marca y con descarga", async ({
    abrir,
  }) => {
    const flujo = leerEstado<Flujo2>("flujo2")
    const { page } = await abrir("cliente")
    await page.goto("/portal/certificados")
    const pendiente = page
      .locator("div.rounded-lg.border")
      .filter({ hasText: "Certificado pendiente" })
      .filter({ hasText: HORARIO })
      .first()
    await expect(pendiente).toBeVisible({ timeout: 45_000 })
    await pendiente.getByLabel("Nombre y apellido de quien firma").fill(FIRMANTE)
    await pendiente.locator('input[type="file"]').setInputFiles(archivoPng("firma-cliente.png"))
    await pendiente.getByRole("button", { name: "Subir firma" }).click()
    await expect(pendiente).toHaveCount(0, { timeout: 30_000 })

    await page.goto(urlPortal(flujo))
    const vista = vistaCertificado(page)
    await expect(vista).toBeVisible({ timeout: 45_000 })
    await expect(vista.getByText("REQUIERE FIRMA")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Descargar PDF/ })).toBeEnabled()
    expect(await vista.innerText()).toMatch(/CERTIFICADO #:\s*\d{2}-\d{2}-\d{4}/)
    expect(await vista.innerText()).toContain(FIRMANTE)
  })

  test("RNF-12 RN-15: la auditoría registra actor, nombre y hora exacta de la firma diferida", async ({
    abrir,
  }) => {
    const flujo = leerEstado<Flujo2>("flujo2")
    // Lo persistido: quién firmó y cuándo, con precisión de segundos.
    const firma = sql(
      `select nombre_firmante || '|' || to_char(captured_at, 'YYYY-MM-DD HH24:MI:SS') from public.firmas_visita where visita_id = '${flujo.visitaId}' and parte = 'cliente'`,
    )
    expect(firma).toMatch(new RegExp(`^${FIRMANTE}\\|\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$`))

    // Lo que ve el Administrador en la pantalla de auditoría.
    const { page } = await abrir("admin")
    await page.goto("/admin/auditoria")
    const fila = page.getByRole("row").filter({ hasText: "cliente@local.test" }).first()
    await expect(fila).toBeVisible({ timeout: 45_000 })
    expect(await fila.innerText()).toMatch(/\d{2}:\d{2}:\d{2}/)
  })
})
