import { crearTareaPorPantalla } from "../support/admin"
import { crearEquipo, nombreUnico, visitaAceptada } from "../support/datos"
import { expect, test } from "../support/fixtures"
import { activarPlantillaDeMigracion, activarPlantillaSinD1, SEGUNDO_TECNICO, TECNICO } from "../support/semilla"
import {
  abrirVisita,
  completarCaptura,
  completarVisita,
  dibujarFirma,
  esperarAgendaEstable,
  estadoVisita,
  firmarTecnico,
  guardarBorrador,
  iniciarBorrador,
  iniciarVisita,
  marcarNoEvaluada,
  omitirFirmaCliente,
  seccionFirmaTecnico,
} from "../support/taller"

/** Visita de una válvula no evaluada: se puede cerrar sin certificado y aísla la firma del técnico. */
async function visitaLista(abrir: Parameters<Parameters<typeof test>[2]>[0]["abrir"]) {
  const visita = await visitaAceptada(1)
  const { page } = await abrir("taller", { viewport: "tablet" })
  const tarjeta = await abrirVisita(page, visita.visitaId)
  await iniciarVisita(page, tarjeta)
  await marcarNoEvaluada(page, visita.valvulas[0].tag, "Sin acceso a la válvula")
  await esperarAgendaEstable(page)
  await omitirFirmaCliente(tarjeta)
  return { page, tarjeta, visita }
}

test.describe("Defectos conocidos del cierre de visita", () => {
  test("RF-25 RN-07 CA-03: con la plantilla de la migración, una captura completa permite cerrar la visita [D1]", async ({
    abrir,
  }) => {
    // Plantilla global: esta prueba es la única que activa la de la migración, y la deja como estaba.
    await activarPlantillaDeMigracion(nombreUnico("D1"))
    try {
      const visita = await visitaAceptada(1)
      const { page } = await abrir("taller", { viewport: "tablet" })
      const tarjeta = await abrirVisita(page, visita.visitaId)
      await iniciarVisita(page, tarjeta)
      const orden = await iniciarBorrador(page, visita.valvulas[0].tag)
      await completarCaptura(page, orden)
      await guardarBorrador(page, orden)
      await esperarAgendaEstable(page)
      await omitirFirmaCliente(tarjeta)
      const seccion = await firmarTecnico(page, tarjeta)
      await completarVisita(page, seccion)
      await expect(estadoVisita(page).first()).toContainText("Visita completada", { timeout: 15_000 })
    } finally {
      await activarPlantillaSinD1(nombreUnico("post-D1"))
    }
  })

  test("RF-25: un cierre fallido se puede reintentar después de corregir la causa [D2]", async ({ abrir }) => {
    const visita = await visitaAceptada(1)
    const { page } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)
    const orden = await iniciarBorrador(page, visita.valvulas[0].tag)
    await esperarAgendaEstable(page)
    await omitirFirmaCliente(tarjeta)

    // Primer intento: la válvula evaluada todavía no tiene certificado completo y el cierre falla.
    const seccion = await firmarTecnico(page, tarjeta)
    await completarVisita(page, seccion)
    // El mensaje se muestra traducido (S5): se acepta el original y la traducción.
    await expect(estadoVisita(page).first()).toContainText(/certificate|certificado/, { timeout: 20_000 })

    // Se corrige la causa y se reintenta con la misma firma.
    await completarCaptura(page, orden, { fotos: false })
    await guardarBorrador(page, orden)
    await esperarAgendaEstable(page)
    await completarVisita(page, seccionFirmaTecnico(tarjeta))
    await expect(estadoVisita(page).first()).toContainText("Visita completada", { timeout: 15_000 })
  })

  test("B1: cancelar la confirmación no completa la visita", async ({ abrir }) => {
    const { page, tarjeta } = await visitaLista(abrir)
    const seccion = await firmarTecnico(page, tarjeta)
    await seccion.getByRole("button", { name: "Completar visita" }).click()
    const dialogo = page.getByRole("alertdialog")
    await expect(dialogo).toBeVisible()
    await dialogo.getByRole("button", { name: "Cancelar" }).click()
    await expect(dialogo).toBeHidden()
    await expect(estadoVisita(page).first()).not.toContainText("Visita completada")
    await expect(seccion.getByRole("button", { name: "Completar visita" })).toBeEnabled()
  })

  test("RF-23 RN-15 CA-13: el selector de técnico ofrece nombre y apellido de la nómina [D3]", async ({ abrir }) => {
    const { tarjeta } = await visitaLista(abrir)
    const opciones = await seccionFirmaTecnico(tarjeta).locator("select").first().locator("option").allInnerTexts()
    expect(opciones.length).toBeGreaterThan(2)
    expect(opciones).toEqual(expect.arrayContaining([TECNICO.completo, SEGUNDO_TECNICO.completo]))
  })

  test("RF-25 RN-15: elegir al técnico de la nómina en el selector permite cerrar la visita [D3]", async ({ abrir }) => {
    const { page, tarjeta } = await visitaLista(abrir)
    const seccion = seccionFirmaTecnico(tarjeta)
    const selector = seccion.locator("select").first()
    const nombre = (await selector.locator("option").nth(1).innerText()).trim()
    await selector.selectOption(nombre)
    await esperarAgendaEstable(page)
    await dibujarFirma(page, seccion)
    await completarVisita(page, seccion)
    await expect(estadoVisita(page).first()).toContainText("Visita completada", { timeout: 15_000 })
  })

  test("RF-25 RN-15: un técnico reemplazante fuera de la nómina puede firmar el cierre [F1]", async ({ abrir }) => {
    const { page, tarjeta } = await visitaLista(abrir)
    const seccion = await firmarTecnico(page, tarjeta, "Mario Reemplazo")
    await completarVisita(page, seccion)
    // F1: cualquier técnico puede firmar, incluido un reemplazante fuera de la nómina.
    await expect(estadoVisita(page).first()).toContainText("Visita completada", { timeout: 15_000 })
  })

  test("RF-15: editar una tarea conserva la fecha de solicitud y guarda el cambio [D11]", async ({ abrir }) => {
    const equipo = await crearEquipo(1)
    const { page } = await abrir("admin")
    const visitaId = await crearTareaPorPantalla(page, { equipo: equipo.equipo, horario: "11:11" })
    await page.goto(`/admin/tareas/${visitaId}`)
    await expect(page.locator("#detalle")).toBeVisible({ timeout: 45_000 })
    await page.locator("#detalle").fill("Detalle editado por la prueba")
    await page.getByRole("button", { name: "Guardar cambios" }).click()
    await expect(page.locator("#fechaSolicitud")).not.toHaveText(/Seleccion|^\s*$/, { timeout: 5_000 })
    // Se espera la confirmación: recargar antes cancela el guardado que todavía está en curso.
    await expect(page.getByText("Tarea actualizada")).toBeVisible({ timeout: 30_000 })
    await page.reload()
    await expect(page.locator("#detalle")).toHaveValue("Detalle editado por la prueba", { timeout: 15_000 })
  })

  test("RF-13 RF-20: el PD/RTO de la tarea llega precargado a la visita [D12]", async ({ abrir }) => {
    const pd = `${Date.now() % 1000000}`
    const visita = await visitaAceptada(1, { pdRto: pd })
    const { page } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)
    const campo = tarjeta.locator('input[id^="parte-diario-code-"]')
    await expect(campo).toBeVisible()
    await esperarAgendaEstable(page)
    await expect(campo).toHaveValue(pd, { timeout: 5_000 })
  })

  test("RNF-06: los errores de cierre se muestran en español [D13]", async ({ abrir }) => {
    const visita = await visitaAceptada(1)
    const { page } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)
    await iniciarBorrador(page, visita.valvulas[0].tag)
    await esperarAgendaEstable(page)
    await omitirFirmaCliente(tarjeta)
    const seccion = await firmarTecnico(page, tarjeta)
    await completarVisita(page, seccion)
    const estado = estadoVisita(page).first()
    await expect(estado).not.toHaveText("", { timeout: 20_000 })
    await expect(estado).toContainText(/certificate|certificado/, { timeout: 20_000 })
    expect(await estado.innerText()).not.toMatch(/\b(every|requires|before|completion)\b/i)
  })
})
