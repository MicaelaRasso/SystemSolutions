import {
  comboTarea,
  completarDatosTarea,
  crearTareaPorPantalla,
  elegirOpcion,
  elegirUbicacion,
} from "../support/admin"
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
    // La celda del día muestra como mucho 3 tarjetas y el calendario también renderiza (ocultas en
    // escritorio) las listas de celular, así que se abre el diálogo del día, que las lista a todas.
    const hoy = Number(fechaArgentina().slice(8, 10))
    const dia = page.getByRole("button", { name: new RegExp(`\\b${hoy}\\b.*: \\d+`) }).first()
    await expect(dia).toBeVisible({ timeout: 45_000 })
    await dia.click()
    const visible = page.getByRole("dialog").last().locator(`button[title*="${contacto}"]`)
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

    // Decisión (d) del cliente: no hay tarea sobre un equipo sin válvulas. Se avisa, se bloquea y
    // la válvula se carga desde el mismo formulario.
    const aviso = page.getByRole("alert").filter({ hasText: "Este equipo no tiene válvulas cargadas" })
    await expect(aviso).toBeVisible()
    await expect(page.getByRole("button", { name: "Crear tarea" })).toBeDisabled()
    await aviso.getByRole("button", { name: "Cargar válvulas" }).click()
    const alta = page.getByRole("dialog", { name: "Nueva válvula de seguridad" })
    await alta.getByLabel("TAG").fill(nombreUnico("PSV"))
    await alta.getByRole("button", { name: "Crear" }).click()
    await expect(aviso).toBeHidden({ timeout: 30_000 })
    // El formulario queda bajo el diálogo modal hasta que se cierra: recién ahí se completa.
    await expect(alta).toBeHidden({ timeout: 30_000 })

    await completarDatosTarea(page, { conTaller: false, horario: "15:40" })
    await page.getByRole("button", { name: "Crear tarea" }).click()
    await expect(page.getByText(/Solicitud N° \d+/).first()).toBeVisible({ timeout: 45_000 })
    expect(sql(`select count(*) from public.equipos_unidades where nombre = '${nombre}'`)).toBe("1")
  })

  test("#94 decisión (e): la visita tiene fin estimado y el mismo equipo admite otra visita en otro horario del día", async ({
    abrir,
  }) => {
    const equipo = await crearEquipo(1)
    const { page } = await abrir("admin")
    // El formulario propone el fin estimado (inicio + 1 h); se cambia a 10:30.
    const visitaId = await crearTareaPorPantalla(page, {
      equipo: equipo.equipo,
      horario: "08:00",
      horaFin: "10:30",
    })

    // La reserva del equipo es [inicio, fin estimado).
    expect(
      sql(
        `select (v.ends_at - v.starts_at) = interval '2 hours 30 minutes'
           and e.ventana = tstzrange(v.starts_at, v.ends_at, '[)')
         from public.visita_equipos e join public.visitas_servicio v on v.id = e.visita_id
         where e.visita_id = '${visitaId}' limit 1`,
      ),
    ).toBe("t")

    // Mismo equipo, más tarde el mismo día y sin superponerse: se crea.
    const segundaId = await crearTareaPorPantalla(page, { equipo: equipo.equipo, horario: "11:00" })
    expect(segundaId).not.toBe(visitaId)

    // Mismo equipo, superpuesta con la primera: se rechaza (23P01).
    await page.goto(`/admin/tareas/nueva?fecha=${fechaArgentina()}`)
    await elegirUbicacion(page)
    await elegirOpcion(page, comboTarea(page, /^Equipo/), equipo.equipo)
    await completarDatosTarea(page, { horario: "09:00" })
    await page.getByRole("button", { name: "Crear tarea" }).click()
    await expect(
      page.getByText("El equipo ya tiene otra visita en ese horario. Elige otro día u horario.").first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/admin\/tareas\/nueva/)
  })

  test("#94: la hora de fin estimada tiene que ser posterior al inicio", async ({ abrir }) => {
    const equipo = await crearEquipo(1)
    const { page } = await abrir("admin")
    await page.goto(`/admin/tareas/nueva?fecha=${fechaArgentina()}`)
    await elegirUbicacion(page)
    await elegirOpcion(page, comboTarea(page, /^Equipo/), equipo.equipo)
    await completarDatosTarea(page, { horario: "10:00", horaFin: "09:00" })
    await page.getByRole("button", { name: "Crear tarea" }).click()
    await expect(
      page.getByText("La hora de fin estimada debe ser posterior a la de inicio"),
    ).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/tareas\/nueva/)
  })

  test("RF-39 RNF-08 CA-15: el cronograma organiza por taller y día", async ({ abrir }) => {
    const { page } = await abrir("admin")
    await page.goto("/admin/cronograma")
    // El nombre del taller también figura en un <select> nativo oculto: se busca la columna.
    await expect(page.getByRole("columnheader", { name: TALLER })).toBeVisible({ timeout: 45_000 })
  })

  test("RF-34 CA-08: el panel muestra métricas de actividad", async ({ abrir }) => {
    const { page } = await abrir("admin")
    await page.goto("/admin")
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/Tareas|Certificados|Visitas/).first()).toBeVisible()
  })
})
