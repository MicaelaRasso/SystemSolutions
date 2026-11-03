import { crearTareaPorPantalla, vistaCertificado } from "../support/admin"
import { edge } from "../support/api"
import { certificadoDeValvula, crearEquipo, type EquipoCreado, nombreUnico } from "../support/datos"
import { guardarEstado, leerEstado } from "../support/estado"
import { expect, test } from "../support/fixtures"
import { TECNICO } from "../support/semilla"
import {
  abrirVisita,
  completarCaptura,
  estadoVisita,
  firmarCliente,
  firmarTecnico,
  guardarBorrador,
  guardarParteDiario,
  iniciarBorrador,
  iniciarVisita,
  marcarNoEvaluada,
  REGEX_UUID,
} from "../support/taller"

type Flujo1 = EquipoCreado & {
  visitaId: string
  pd: string
  ot: string
  representante: string
  contacto: string
  certificadoId?: string
}

const REPRESENTANTE = "Juan Pérez"
/** La tarjeta de una visita pendiente solo muestra fecha y hora: el horario la distingue. */
const HORARIO = "07:17"

test.describe("Flujo 1: creación, captura en tablet y firma presencial", () => {
  test("RF-13 RF-16 RN-11 CA-01: el Administrador crea la tarea con PD/RTO y orden de trabajo, y recibe número de solicitud", async ({
    abrir,
  }) => {
    const equipo = await crearEquipo(2)
    const pd = `40${Date.now() % 100000}`
    const ot = `OT${Date.now() % 100000}`
    const contacto = nombreUnico("Pedro")
    const { page } = await abrir("admin")
    const visitaId = await crearTareaPorPantalla(page, {
      equipo: equipo.equipo,
      pdRto: pd,
      ordenTrabajo: ot,
      contacto,
      horario: HORARIO,
    })

    await expect(page.getByRole("heading", { name: /Solicitud N° \d+/ })).toBeVisible()
    await expect(page.locator('input[name="ordenTrabajo"]')).toHaveValue(ot)
    await expect(page.locator('input[name="pdRto"]')).toHaveValue(pd)
    guardarEstado("flujo1", {
      ...equipo,
      visitaId,
      pd,
      ot,
      contacto,
      representante: REPRESENTANTE,
    } satisfies Flujo1)
  })

  test("RF-17 RF-20 RF-21 RF-22 RF-23 RF-25 RN-07 CA-03 CA-10: el Taller captura en tablet y cierra con firma presencial", async ({
    abrir,
  }) => {
    const flujo = leerEstado<Flujo1>("flujo1")
    const [primera, segunda] = flujo.valvulas
    const { page } = await abrir("taller", { viewport: "tablet" })

    await test.step("acepta y abre la visita: ve TAG y equipo, sin identificadores internos", async () => {
      await page.goto("/taller")
      const pendiente = page.locator('[data-slot="card"]').filter({ hasText: HORARIO })
      await expect(pendiente.first()).toBeVisible({ timeout: 45_000 })
      await expect(async () => {
        await pendiente.first().getByRole("button", { name: "Aceptar", exact: true }).click({ timeout: 5_000 })
        await expect(page.locator(`[data-visit-id="${flujo.visitaId}"]`)).toBeVisible({ timeout: 15_000 })
      }).toPass({ timeout: 60_000 })
      const tarjeta = await abrirVisita(page, flujo.visitaId)
      await expect(tarjeta).toContainText(flujo.equipo)
      await expect(tarjeta.getByText(new RegExp(`V[aá]lvula ${primera.tag}`))).toBeVisible()
      expect(await tarjeta.innerText()).not.toMatch(REGEX_UUID)
    })

    const tarjeta = await abrirVisita(page, flujo.visitaId)

    await test.step("inicia la visita y registra el Parte Diario con foto", async () => {
      await iniciarVisita(page, tarjeta)
      await guardarParteDiario(page, tarjeta, flujo.pd)
    })

    await test.step("marca la válvula evaluada y captura todos los campos", async () => {
      const orden = await iniciarBorrador(page, primera.tag)
      // RF-20: la cabecera técnica llega precargada desde la jerarquía.
      await expect(orden.locator('[id="certificate-technical-tag"]')).toHaveValue(primera.tag)
      const elegidas = await completarCaptura(page, orden)
      for (const valor of Object.values(elegidas)) expect(valor).not.toBe("")
      // Regresión del 400 de `repuestos`: «Otros» queda vacío a propósito.
      await expect(orden.locator('[id="certificate-other-parts"]')).toHaveValue("")
      await guardarBorrador(page, orden)
      // Tras guardar, el formulario se vuelve a montar con lo persistido.
      await expect(orden.locator('[id="certificate-technical-marca"]')).toHaveValue("Farris")
      await expect(orden.getByRole("alert")).toHaveCount(0)
    })

    await test.step("la válvula restante queda no evaluada con motivo", async () => {
      await marcarNoEvaluada(page, segunda.tag, "Sin acceso a la válvula")
    })

    await test.step("firma el representante y luego el técnico; se completa la visita", async () => {
      await firmarCliente(page, tarjeta, flujo.representante)
      const seccion = await firmarTecnico(page, tarjeta)
      await seccion.getByRole("button", { name: "Completar visita" }).click()
      await expect(estadoVisita(page).first()).toContainText("Visita completada", { timeout: 30_000 })
    })

    const certificadoId = certificadoDeValvula(flujo.visitaId, primera.id)
    guardarEstado("flujo1", { ...flujo, certificadoId } satisfies Flujo1)
  })

  test.describe("El Administrador consulta el certificado emitido", () => {
    const abrirCertificado = async (page: import("@playwright/test").Page) => {
      const flujo = leerEstado<Flujo1>("flujo1")
      if (!flujo.certificadoId) throw new Error("Precondición: el flujo de captura no terminó")
      await page.goto(`/admin/certificados/${flujo.certificadoId}`)
      await expect(vistaCertificado(page)).toBeVisible({ timeout: 45_000 })
      await expect(vistaCertificado(page)).toContainText(flujo.valvulas[0].tag)
      return flujo
    }

    test("RF-26 RN-12 CA-02: el certificado con ambas firmas tiene número emitido y sin marca REQUIERE FIRMA", async ({
      abrir,
    }) => {
      const { page } = await abrir("admin")
      await abrirCertificado(page)
      const vista = vistaCertificado(page)
      expect(await vista.innerText()).toMatch(/CERTIFICADO #:\s*\d{2}-\d{2}-\d{4}/)
      await expect(vista.getByText("REQUIERE FIRMA")).toHaveCount(0)
    })

    test("RF-27 RNF-09: las secciones 1.0 a 1.5 aparecen en orden, seguidas del ANEXO", async ({ abrir }) => {
      const { page } = await abrir("admin")
      await abrirCertificado(page)
      const texto = await vistaCertificado(page).innerText()
      const posiciones = [
        "1.0 UBICACIÓN",
        "1.1 VÁLVULA DE SEGURIDAD",
        "1.2 MANTENIMIENTO",
        "1.3 ENSAYOS",
        "1.4 OBSERVACIONES",
        "1.5 APROBACIÓN",
        "ANEXO — REGISTRO FOTOGRÁFICO",
      ].map((titulo) => texto.indexOf(titulo))
      expect(posiciones.every((posicion) => posicion >= 0)).toBe(true)
      expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b))
    })

    test("RF-23 RN-15: la aprobación muestra el nombre y la fecha de ambos firmantes", async ({ abrir }) => {
      const { page } = await abrir("admin")
      const flujo = await abrirCertificado(page)
      const texto = await vistaCertificado(page).innerText()
      for (const nombre of [TECNICO.completo, flujo.representante]) expect(texto).toContain(nombre)
      expect(texto).toMatch(/\d{2}\/\d{2}\/\d{4}/)
    })

    test("RF-23: la aprobación muestra las firmas dibujadas [D7]", async ({ abrir }) => {
      const { page } = await abrir("admin")
      const flujo = await abrirCertificado(page)
      // D7: las firmas no llegan al certificado; solo se ve el nombre.
      test.fail(true, "D7: firmas y fotos no se muestran en el certificado")
      const firmas = vistaCertificado(page).getByRole("img", { name: /^Firma de / })
      await expect(firmas).toHaveCount(2, { timeout: 8_000 })
      await expect(vistaCertificado(page).getByRole("img", { name: `Firma de ${flujo.representante}` })).toBeVisible()
    })

    test("RF-22 RF-27 RF-35: el ANEXO muestra las 3 fotos de la válvula [D7]", async ({ abrir }) => {
      const { page } = await abrir("admin")
      await abrirCertificado(page)
      const anexo = page.getByRole("region", { name: "Anexo fotográfico" })
      await expect(anexo.getByText("FOTO VÁLVULA DESARMADA")).toBeVisible()
      // D7: las secciones del anexo salen vacías aunque las fotos se cargaron.
      test.fail(true, "D7: firmas y fotos no se muestran en el certificado")
      for (const descripcion of [
        "Válvula desarmada, foto 1",
        "Válvula armada para ensayos, foto 1",
        "Válvula armada con chapa y precinto, foto 1",
      ]) {
        await expect(anexo.getByRole("img", { name: descripcion })).toBeVisible({ timeout: 8_000 })
      }
    })

    test("RF-27: el ANEXO muestra la foto y el número del Parte Diario [D7]", async ({ abrir }) => {
      const { page } = await abrir("admin")
      const flujo = await abrirCertificado(page)
      const anexo = page.getByRole("region", { name: "Anexo fotográfico" })
      await expect(anexo.getByText("FOTO VÁLVULA DESARMADA")).toBeVisible()
      test.fail(true, "D7: firmas y fotos no se muestran en el certificado")
      await expect(anexo.getByText(`FOTO PARTE DIARIO (${flujo.pd})`)).toBeVisible({ timeout: 8_000 })
      await expect(anexo.getByRole("img", { name: /^Parte diario, foto/ })).toBeVisible({ timeout: 8_000 })
    })

    test("RF-13 RF-27: el certificado muestra la orden de trabajo de la tarea [D10]", async ({ abrir }) => {
      const { page } = await abrir("admin")
      const flujo = await abrirCertificado(page)
      // D10: orden de trabajo vacía en el certificado aunque la tarea la tiene.
      const texto = await vistaCertificado(page).innerText()
      expect(texto).toContain("ORDEN DE TRABAJO:")
      test.fail(true, "D10: orden de trabajo, vencimiento de patrón y nómina vacíos en el certificado")
      expect(texto).toMatch(new RegExp(`ORDEN DE TRABAJO:\s*${flujo.ot}`))
    })

    test("RF-38 RN-15 CA-13: el certificado muestra la nómina de la jornada [D10]", async ({ abrir }) => {
      const { page } = await abrir("admin")
      await abrirCertificado(page)
      test.fail(true, "D10: orden de trabajo, vencimiento de patrón y nómina vacíos en el certificado")
      const texto = await vistaCertificado(page).innerText()
      expect(texto).toMatch(/Nómina del taller[^\n]*\n?[^\n—]*Tomas/i)
    })

    test("RF-27: el certificado muestra el vencimiento del patrón [D10]", async ({ abrir }) => {
      const { page } = await abrir("admin")
      await abrirCertificado(page)
      test.fail(true, "D10: orden de trabajo, vencimiento de patrón y nómina vacíos en el certificado")
      const texto = await vistaCertificado(page).innerText()
      expect(texto).toMatch(/VENCIMIENTO[^\n]*\n?\s*\d{2}\/\d{2}\/\d{4}/i)
    })

    test("RN-05 RF-29 CA-05: el Administrador descarga el PDF", async ({ abrir }) => {
      const { page } = await abrir("admin")
      await abrirCertificado(page)
      await expect(page.getByRole("button", { name: /Descargar PDF/ })).toBeEnabled()
      await page.emulateMedia({ media: "print" })
      const pdf = await page.pdf({ format: "A4", printBackground: true })
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF")
      expect(pdf.length).toBeGreaterThan(5_000)
    })

    test("RN-16 RF-43 CA-14: el documento propone el nombre de archivo de la nomenclatura al imprimir", async ({
      abrir,
    }) => {
      const { page } = await abrir("admin")
      const flujo = await abrirCertificado(page)
      await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")))
      await expect(page).toHaveTitle(new RegExp(`${flujo.valvulas[0].tag}_${flujo.equipo}_`))
      await page.evaluate(() => window.dispatchEvent(new Event("afterprint")))
    })
  })

  test("RF-40 RN-03: la API conserva la orden no evaluada con su motivo", async () => {
    const flujo = leerEstado<Flujo1>("flujo1")
    const operacion = await edge<{
      work_orders: { work_order: { valvula_id: string; estado: string; no_evaluada_razon: string } }[]
    }>("admin", "service-workflow", `operations/${flujo.visitaId}`)
    const orden = operacion.work_orders.find((o) => o.work_order.valvula_id === flujo.valvulas[1].id)
    expect(orden?.work_order.estado).toBe("no_evaluada")
    expect(orden?.work_order.no_evaluada_razon).toBe("Sin acceso a la válvula")
  })
})
