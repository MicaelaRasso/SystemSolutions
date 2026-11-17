import { sql } from "../support/api"
import { vencerVisita, visitaAceptada } from "../support/datos"
import { expect, test } from "../support/fixtures"
import { capturarSinConexion, prepararSinConexion } from "../support/offline"
import {
  abrirVisita,
  firmarTecnico,
  iniciarVisita,
  omitirFirmaCliente,
  tarjetaVisita,
} from "../support/taller"

const MOTIVO_VENCIDA = "The visit was closed at the end of its day and requires finalization"

test.describe("Visita en «Requiere finalización» (#96, #97)", () => {
  test("lo hecho sin conexión después del vencimiento queda en conflicto para el Administrador", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await prepararSinConexion(page, context, visita.visitaId)
    await capturarSinConexion(page, tarjeta, visita, { pd: "PD9601", representante: "Juan Perez" })

    // Mientras el dispositivo está sin red, la visita se inicia en el servidor y vence.
    sql(
      `update public.visitas_servicio set estado = 'en_curso', started_at = now() - interval '1 day'
       where id = '${visita.visitaId}'`,
    )
    expect(vencerVisita(visita.visitaId)).toBeGreaterThanOrEqual(1)

    await context.setOffline(false)
    await page.getByRole("button", { name: "Actualizar agenda" }).click()
    const card = tarjetaVisita(page, visita.visitaId)
    await expect(card.getByText("Requiere finalización").first()).toBeVisible({ timeout: 45_000 })
    await expect(card.getByText(/venció a las 23:59/).first()).toBeVisible()

    // Nada se aplicó y cada operación quedó en conflicto, sin reintentos.
    await expect
      .poll(() =>
        sql(
          `select count(*) from public.conflictos_sync
           where visita_id = '${visita.visitaId}' and reason = '${MOTIVO_VENCIDA}'`,
        ),
      )
      .not.toBe("0")
    expect(sql(`select estado from public.visitas_servicio where id = '${visita.visitaId}'`)).toBe(
      "requiere_finalizacion",
    )
    const conflictos = sql(
      `select count(*) from public.conflictos_sync where visita_id = '${visita.visitaId}'`,
    )
    await page.getByRole("button", { name: "Actualizar agenda" }).click()
    await expect
      .poll(() =>
        sql(`select count(*) from public.conflictos_sync where visita_id = '${visita.visitaId}'`),
      )
      .toBe(conflictos)

    // El Administrador ve el motivo traducido y el tipo en español.
    const admin = await abrir("admin")
    // El panel de conflictos está en el tablero del Administrador.
    await admin.page.goto("/admin")
    await expect(admin.page.getByText("Visita cerrada por vencimiento").first()).toBeVisible({
      timeout: 45_000,
    })
    await expect(admin.page.getByText("Completar visita").first()).toBeVisible()
  })

  test("el Técnico firma desde el panel y el Administrador cierra con motivo y seguimiento", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(2)
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
    expect(vencerVisita(visita.visitaId)).toBeGreaterThanOrEqual(1)

    await page.getByRole("button", { name: "Actualizar agenda" }).click()
    const vencida = await abrirVisita(page, visita.visitaId)
    await expect(vencida.getByText("Finalización de la visita vencida")).toBeVisible({
      timeout: 45_000,
    })
    await omitirFirmaCliente(vencida)
    const seccion = await firmarTecnico(page, vencida, "Reemplazo Fuera De Nomina")
    await seccion.getByRole("button", { name: "Registrar firma del Técnico" }).click()
    await expect(vencida.getByText(/Falta que el Administrador cierre la visita/)).toBeVisible({
      timeout: 30_000,
    })
    expect(
      sql(
        `select count(*) from public.firmas_visita where visita_id = '${visita.visitaId}' and parte = 'tecnico'`,
      ),
    ).toBe("1")

    const admin = await abrir("admin")
    await admin.page.goto(`/admin/tareas/${visita.visitaId}`)
    await admin.page.getByRole("button", { name: "Cerrar con motivo" }).click()
    const dialogo = admin.page.getByRole("dialog", { name: "Cerrar visita vencida" })
    await dialogo.getByLabel("Motivo del cierre").fill("No se llegó a revisar las válvulas")
    await dialogo.getByLabel("Fecha").fill("2099-12-01")
    await dialogo.getByRole("button", { name: "Cerrar visita" }).click()
    await expect(admin.page).not.toHaveURL(new RegExp(`/admin/tareas/${visita.visitaId}$`), {
      timeout: 45_000,
    })

    expect(sql(`select estado from public.visitas_servicio where id = '${visita.visitaId}'`)).toBe(
      "completada",
    )
    expect(
      sql(
        `select count(*) from public.registros_auditoria
         where visita_id = '${visita.visitaId}' and accion = 'visita_cierre_administrativo'`,
      ),
    ).toBe("1")
    // La visita de seguimiento lleva el fin estimado propuesto: inicio (09:00) + 1 h.
    expect(
      sql(
        `select count(*) || ':' || bool_and(ends_at - starts_at = interval '1 hour')
         from public.visitas_servicio
         where solicitud_id = '${visita.solicitudId}' and id <> '${visita.visitaId}'`,
      ),
    ).toBe("1:true")
  })
})
