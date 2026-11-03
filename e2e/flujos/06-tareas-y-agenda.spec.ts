import { comboTarea, completarDatosTarea, crearTareaPorPantalla, elegirUbicacion } from "../support/admin"
import { sql } from "../support/api"
import { crearEquipo, nombreUnico } from "../support/datos"
import { expect, test } from "../support/fixtures"
import { CLIENTE, fechaArgentina, TALLER } from "../support/semilla"

test.describe("Tareas y agenda del Administrador", () => {
  test("RF-15: una tarea cancelada se reactiva y vuelve a admitir cambios", async ({ abrir }) => {
    const equipo = await crearEquipo(1)
    const { page } = await abrir("admin")
    const visitaId = await crearTareaPorPantalla(page, { equipo: equipo.equipo, horario: "12:10" })

    await page.getByRole("button", { name: "Cancelar tarea" }).first().click()
    const dialogo = page.getByRole("alertdialog").or(page.getByRole("dialog")).last()
    await dialogo.locator("textarea, input").first().fill("Prueba de cancelación")
    await dialogo.getByRole("button", { name: "Cancelar tarea" }).click()
    const reactivar = page.getByRole("button", { name: "Reactivar tarea" })
    await expect(reactivar).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole("button", { name: "Marcar evaluada" })).toHaveCount(0)
    expect(sql(`select estado from public.visitas_servicio where id = '${visitaId}'`)).toBe("cancelada")

    await reactivar.click()
    const confirmar = page.getByRole("alertdialog").or(page.getByRole("dialog")).last().getByRole("button", { name: /Reactivar|Confirmar/ })
    if (await confirmar.isVisible()) await confirmar.click()
    await expect(page.getByRole("button", { name: "Cancelar tarea" }).first()).toBeVisible({ timeout: 30_000 })
    await expect(reactivar).toHaveCount(0)
    expect(sql(`select estado from public.visitas_servicio where id = '${visitaId}'`)).not.toBe("cancelada")
  })

  test("RF-10 RF-11 RF-12 CA-15: la agenda muestra horario, cliente, planta, contacto, teléfono y detalle en la tarjeta", async ({
    abrir,
  }) => {
    const equipo = await crearEquipo(1)
    const contacto = nombreUnico("Marta")
    const telefono = "299-555-0177"
    const detalle = `Detalle ${nombreUnico("agenda")}`
    const { page } = await abrir("admin")
    await crearTareaPorPantalla(page, { equipo: equipo.equipo, horario: "13:20", contacto, telefono, detalle })

    await page.goto("/admin/agenda")
    const tarjeta = page.locator(`button[title*="${contacto}"]`).first()
    await tarjeta.waitFor({ state: "attached", timeout: 45_000 }).catch(() => undefined)
    if ((await tarjeta.count()) === 0) {
      // El día tiene más tarjetas de las que entran: se abre el diálogo del día.
      await page.getByText(/\+\d+ más/).first().click()
    }
    const visible = page.locator(`button[title*="${contacto}"]`).first()
    await expect(visible).toBeVisible({ timeout: 30_000 })
    for (const texto of ["13:20", CLIENTE, TALLER, "Planta Uno", contacto, telefono, detalle]) {
      await expect(visible).toContainText(texto)
    }
  })

  test("RF-12: al tocar una tarjeta de la agenda se abre el detalle de la tarea", async ({ abrir }) => {
    const equipo = await crearEquipo(1)
    const contacto = nombreUnico("Beto")
    const { page } = await abrir("admin")
    await crearTareaPorPantalla(page, { equipo: equipo.equipo, horario: "14:30", contacto })
    await page.goto("/admin/agenda")
    const hoy = Number(fechaArgentina().slice(8, 10))
    const dia = page.getByRole("button", { name: new RegExp(`\\b${hoy}\\b.*: \\d+`) }).first()
    await expect(dia).toBeVisible({ timeout: 45_000 })
    await dia.click()
    const dialogo = page.getByRole("dialog").last()
    await expect(dialogo).toBeVisible()
    await dialogo.locator(`button[title*="${contacto}"]`).click()
    await expect(page.getByRole("heading", { name: /Solicitud N° \d+/ })).toBeVisible()
  })

  test("RF-13 RF-14: desde Nueva Tarea se crea un equipo sin salir del formulario, sin taller asignado", async ({ abrir }) => {
    const nombre = nombreUnico("EQ-NUEVO")
    const { page } = await abrir("admin")
    await page.goto(`/admin/tareas/nueva?fecha=${fechaArgentina()}`)
    await elegirUbicacion(page)

    const combo = comboTarea(page, /^Equipo/)
    await combo.click()
    await page.getByRole("option", { name: /Agregar/ }).first().click()
    const dialogo = page.getByRole("dialog").last()
    await dialogo.locator('input:not([type="hidden"])').first().fill(nombre)
    await dialogo.getByRole("button", { name: "Crear" }).click()
    await expect(combo).toContainText(nombre, { timeout: 30_000 })

    await completarDatosTarea(page, { conTaller: false, horario: "15:40" })
    await page.getByRole("button", { name: "Crear tarea" }).click()
    await expect(page.getByText(/Solicitud N° \d+/).first()).toBeVisible({ timeout: 45_000 })
    expect(sql(`select count(*) from public.equipos where nombre = '${nombre}'`)).toBe("1")
  })

  test("RF-39 RNF-08 CA-15: el cronograma organiza por taller y día", async ({ abrir }) => {
    const { page } = await abrir("admin")
    await page.goto("/admin/cronograma")
    await expect(page.getByText(TALLER).first()).toBeVisible({ timeout: 45_000 })
  })

  test("RF-34 CA-08: el panel muestra métricas de actividad", async ({ abrir }) => {
    const { page } = await abrir("admin")
    await page.goto("/admin")
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/Tareas|Certificados|Visitas/).first()).toBeVisible()
  })
})
