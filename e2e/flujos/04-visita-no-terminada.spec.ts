import { edge } from "../support/api"
import { visitaAceptada, type VisitaProgramada } from "../support/datos"
import { guardarEstado, leerEstado } from "../support/estado"
import { expect, test } from "../support/fixtures"
import { fechaArgentina } from "../support/semilla"
import {
  abrirVisita,
  completarCaptura,
  esperarAgendaEstable,
  estadoVisita,
  firmarCliente,
  firmarTecnico,
  guardarBorrador,
  iniciarBorrador,
  iniciarVisita,
} from "../support/taller"

const MOTIVO = "Falta de tiempo en la jornada"

test.describe("Flujo 4: visita no terminada y reprogramación agrupada", () => {
  test("RF-25 RF-40: de 3 válvulas se certifica una y se cierra como no terminada con motivo", async ({ abrir }) => {
    const visita = await visitaAceptada(3)
    const { page } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)
    const orden = await iniciarBorrador(page, visita.valvulas[0].tag)
    await completarCaptura(page, orden)
    await guardarBorrador(page, orden)
    await esperarAgendaEstable(page)
    await firmarCliente(page, tarjeta, "Juan Pérez")
    const seccion = await firmarTecnico(page, tarjeta)
    await seccion.getByPlaceholder("Motivo para reprogramar las válvulas faltantes").fill(MOTIVO)
    await seccion.getByRole("button", { name: /Visita no terminada/ }).click()
    await expect(estadoVisita(page).first()).toContainText("Visita cerrada como no terminada", { timeout: 30_000 })
    guardarEstado("flujo4", visita satisfies VisitaProgramada)
  })

  test("RF-15 RF-25: el Administrador ve las válvulas faltantes preseleccionadas para reprogramar", async ({ abrir }) => {
    const visita = leerEstado<VisitaProgramada>("flujo4")
    const { page } = await abrir("admin")
    await page.goto(`/admin/tareas/${visita.visitaId}`)
    const formulario = page.locator("form").filter({ hasText: "Crear visita de seguimiento" })
    await expect(formulario).toBeVisible({ timeout: 45_000 })
    const [, faltante1, faltante2] = visita.valvulas
    for (const { tag } of [faltante1, faltante2]) {
      await expect(formulario.getByRole("checkbox", { name: new RegExp(tag) })).toBeChecked()
      await expect(formulario.getByText(MOTIVO).first()).toBeVisible()
    }
    await expect(formulario.getByRole("checkbox")).toHaveCount(2)
  })

  test("RF-15 RF-35 RN-02: la visita de seguimiento se crea y ambas aparecen bajo una solicitud en /portal/turnos [D5]", async ({
    abrir,
  }) => {
    const visita = leerEstado<VisitaProgramada>("flujo4")
    const { page } = await abrir("admin")
    await page.goto(`/admin/tareas/${visita.visitaId}`)
    const formulario = page.locator("form").filter({ hasText: "Crear visita de seguimiento" })
    await expect(formulario).toBeVisible({ timeout: 45_000 })
    await formulario.locator("select").selectOption({ index: 1 })
    await formulario.locator('input[type="date"]').fill(fechaArgentina(1))
    await formulario.locator('input[type="time"]').fill("10:00")
    await formulario.getByRole("button", { name: "Crear visita de seguimiento" }).click()

    // D5: `follow-up-visits` falta en supabase/functions/_shared/route.ts y responde 404. Detrás de
    // este bloqueo queda sin cubrir el listado agrupado en el portal: no hay otra vía en la app.
    test.fail(true, "D5: la ruta follow-up-visits da 404")
    await expect(page).not.toHaveURL(new RegExp(visita.visitaId), { timeout: 15_000 })

    const solicitud = await edge<{ visit: { solicitud_id: string } }>(
      "admin",
      "service-workflow",
      `visits/${visita.visitaId}`,
    )
    expect(solicitud.visit.solicitud_id).toBe(visita.solicitudId)
    const { page: cliente } = await abrir("cliente")
    await cliente.goto("/portal/turnos")
    await expect(cliente.getByText(visita.equipo)).toHaveCount(2)
  })

  test("RF-35 RF-11: el Cliente ve la visita de la solicitud en /portal/turnos", async ({ abrir }) => {
    const { page } = await abrir("cliente")
    await page.goto("/portal/turnos")
    await expect(page.getByRole("heading", { name: /Turnos|Visitas/ }).first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText("Campo Sur").first()).toBeVisible({ timeout: 45_000 })
  })
})
