import { edge, sql } from "./api"
import { fechaArgentina, leerSemilla } from "./semilla"

const corrida = () => {
  const valor = process.env.E2E_CORRIDA
  if (!valor) throw new Error("Falta E2E_CORRIDA: la define e2e/global-setup.ts")
  return valor
}

let secuencia = 0

/** Nombre único en la base: varias corridas pueden convivir sobre los mismos datos. */
export function nombreUnico(prefijo: string) {
  secuencia += 1
  return `${prefijo}-${corrida()}${process.pid % 1000}${secuencia}`
}

export type EquipoCreado = {
  equipoId: string
  equipo: string
  valvulas: { id: string; tag: string }[]
}

/** Crea un equipo propio de la prueba bajo la planta sembrada. */
export async function crearEquipo(cantidadValvulas: number): Promise<EquipoCreado> {
  const { plantaId } = leerSemilla()
  const equipo = nombreUnico("K")
  const { id: equipoId } = await edge<{ id: string }>("admin", "asset-access", "hierarchy", {
    method: "POST",
    body: { kind: "equipo", parent_id: plantaId, name: equipo },
  })
  const valvulas: EquipoCreado["valvulas"] = []
  for (let i = 0; i < cantidadValvulas; i += 1) {
    const tag = nombreUnico("PSV")
    const { id } = await edge<{ id: string }>("admin", "asset-access", "hierarchy", {
      method: "POST",
      body: { kind: "valvula", parent_id: equipoId, name: tag },
    })
    valvulas.push({ id, tag })
  }
  return { equipoId, equipo, valvulas }
}

export type VisitaProgramada = EquipoCreado & { solicitudId: string; visitaId: string }

export type MetadatosTarea = {
  contacto?: string
  telefono?: string
  detalle?: string
  pdRto?: string
  ordenTrabajo?: string
  fecha?: string
  horario?: string
}

/** El mismo recorrido de escritura que hace el formulario de tarea, por la API de la app. */
export async function programarVisita(
  equipo: EquipoCreado,
  metadatos: MetadatosTarea = {},
): Promise<VisitaProgramada> {
  const { cuentas, yacimientoId, tallerId } = leerSemilla()
  const fecha = metadatos.fecha ?? fechaArgentina()
  const horario = metadatos.horario ?? "09:30"
  const solicitud = await edge<{ request: { id: string } }>(
    "admin",
    "service-workflow",
    "admin/requests",
    {
      method: "POST",
      body: {
        cliente_cuenta_id: cuentas.cliente,
        yacimiento_id: yacimientoId,
        selections: [{ kind: "equipo", id: equipo.equipoId }],
      },
    },
  )
  const solicitudId = solicitud.request.id
  await edge("admin", "service-workflow", `requests/${solicitudId}/metadata`, {
    method: "PATCH",
    body: {
      metadata: {
        contacto: metadatos.contacto ?? "Pedro Contacto",
        telefono: metadatos.telefono ?? "299-555-0199",
        fecha_ejecucion: fecha,
        horario,
        tipo: "calibracion",
        detalle: metadatos.detalle ?? "Calibración anual",
        pd_rto: metadatos.pdRto ?? null,
        orden_trabajo: metadatos.ordenTrabajo ?? null,
        condiciones: [],
        adjuntos: [],
      },
    },
  })
  const inicio = new Date(`${fecha}T${horario}:00-03:00`)
  const programada = await edge<{ visit: { id: string } }>(
    "admin",
    "service-workflow",
    `requests/${solicitudId}/schedule`,
    {
      method: "POST",
      body: {
        taller_movil_id: tallerId,
        starts_at: inicio.toISOString(),
        // Fin estimado: una hora. Reserva el equipo en ese horario; no cierra la visita.
        ends_at: new Date(inicio.getTime() + 3_600_000).toISOString(),
      },
    },
  )
  return { ...equipo, solicitudId, visitaId: programada.visit.id }
}

/** Equipo nuevo, visita programada para hoy y aceptada por el taller. */
export async function visitaAceptada(cantidadValvulas: number, metadatos: MetadatosTarea = {}) {
  liberarTallerSemilla()
  const visita = await programarVisita(await crearEquipo(cantidadValvulas), metadatos)
  await edge("taller", "service-workflow", `visits/${visita.visitaId}/accept`, {
    method: "POST",
    body: {},
  })
  return visita
}

/** Certificado de la válvula en esa visita, leído de lo que quedó persistido. */
export function certificadoDeValvula(visitaId: string, valvulaId: string): string {
  const id = sql(
    `select id from public.certificados where visita_id = '${visitaId}' and valvula_id = '${valvulaId}' order by created_at desc limit 1`,
  )
  if (!id) throw new Error(`La válvula ${valvulaId} todavía no tiene certificado`)
  return id
}

/**
 * Simula que la visita en curso se inició ayer y corre el cierre automático (el job de pg_cron de
 * las 23:59 AR, #95). Devuelve cuántas visitas cerró la corrida.
 */
export function vencerVisita(visitaId: string): number {
  sql(
    `update public.visitas_servicio set started_at = now() - interval '1 day'
     where id = '${visitaId}' and estado = 'en_curso'`,
  )
  return Number(sql("select public.close_expired_visits()"))
}

/**
 * Un Taller Móvil atiende una visita a la vez: el servidor no deja iniciar otra mientras una sigue
 * en curso y el panel del taller lo bloquea. Las pruebas comparten el taller sembrado, así que antes
 * de preparar la visita de una prueba se cierran, como lo haría el job de las 23:59 AR, las que
 * hayan quedado en curso (de pruebas anteriores o de otras corridas sobre la misma base).
 */
export function liberarTallerSemilla(): number {
  const { tallerId } = leerSemilla()
  sql(
    `update public.visitas_servicio set started_at = now() - interval '1 day'
     where taller_movil_id = '${tallerId}' and estado = 'en_curso'`,
  )
  return Number(sql("select public.close_expired_visits()"))
}
