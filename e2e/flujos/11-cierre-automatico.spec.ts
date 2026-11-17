import { crearEquipo, programarVisita, vencerVisita, visitaAceptada } from "../support/datos"
import { edge, sql } from "../support/api"
import { expect, test } from "../support/fixtures"
import { abrirVisita, iniciarVisita } from "../support/taller"

test.describe("Cierre automático de visitas (#95, decisión (e))", () => {
  test("una visita iniciada que no se completó pasa a «Requiere finalización» y libera el equipo", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const { page } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)
    await expect
      .poll(
        () => sql(`select estado from public.visitas_servicio where id = '${visita.visitaId}'`),
        {
          timeout: 30_000,
        },
      )
      .toBe("en_curso")

    // El job de las 23:59 AR, forzado: la visita se inició «ayer».
    expect(vencerVisita(visita.visitaId)).toBeGreaterThanOrEqual(1)
    expect(sql(`select estado from public.visitas_servicio where id = '${visita.visitaId}'`)).toBe(
      "requiere_finalizacion",
    )
    expect(
      sql(`select count(*) from public.visita_equipos where visita_id = '${visita.visitaId}'`),
    ).toBe("0")
    expect(
      sql(
        `select count(*) from public.registros_auditoria
         where visita_id = '${visita.visitaId}' and accion = 'visita_requiere_finalizacion'`,
      ),
    ).toBe("1")
    // Idempotente: una segunda corrida no vuelve a cerrarla ni duplica la auditoría.
    vencerVisita(visita.visitaId)
    expect(
      sql(
        `select count(*) from public.registros_auditoria
         where visita_id = '${visita.visitaId}' and accion = 'visita_requiere_finalizacion'`,
      ),
    ).toBe("1")

    // El Administrador ve el estado nuevo en la tarea. (El panel del taller para completar la
    // visita vencida llega con #97.)
    const admin = await abrir("admin")
    await admin.page.goto(`/admin/tareas/${visita.visitaId}`)
    await expect(admin.page.getByText("Requiere finalización").first()).toBeVisible({
      timeout: 45_000,
    })
  })

  test("un taller atiende una visita a la vez: no inicia otra hasta completar o cerrar la que está en curso", async ({
    abrir,
  }) => {
    const primera = await visitaAceptada(1, { horario: "08:00" })
    // Segunda visita del mismo taller (otro equipo), aceptada sin volver a liberar el taller.
    const segunda = await programarVisita(await crearEquipo(1), { horario: "10:00" })
    await edge("taller", "service-workflow", `visits/${segunda.visitaId}/accept`, {
      method: "POST",
      body: {},
    })

    const { page } = await abrir("taller", { viewport: "tablet" })
    await iniciarVisita(page, await abrirVisita(page, primera.visitaId))
    await expect
      .poll(
        () => sql(`select estado from public.visitas_servicio where id = '${primera.visitaId}'`),
        {
          timeout: 30_000,
        },
      )
      .toBe("en_curso")

    // El panel no ofrece iniciar la segunda y explica por qué.
    const tarjeta = await abrirVisita(page, segunda.visitaId)
    await expect(tarjeta.getByRole("button", { name: "Iniciar Visita de servicio" })).toBeDisabled()
    await expect(
      tarjeta.getByText(/Hay otra visita en curso.*Completala antes de iniciar esta/),
    ).toBeVisible()

    // Cuando la primera deja de estar en curso (cierre de las 23:59), la segunda se puede iniciar.
    expect(vencerVisita(primera.visitaId)).toBeGreaterThanOrEqual(1)
    await iniciarVisita(page, await abrirVisita(page, segunda.visitaId))
    await expect
      .poll(
        () => sql(`select estado from public.visitas_servicio where id = '${segunda.visitaId}'`),
        {
          timeout: 30_000,
        },
      )
      .toBe("en_curso")
  })
})
