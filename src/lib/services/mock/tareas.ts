import { addDays, format, parseISO } from "date-fns"

import { normalizarEstadoTarea } from "@/lib/domain/rules"
import type { Tarea } from "@/lib/domain/types"

import { ServiceError, type CronogramaRepo, type TareaResumen, type TareasRepo } from "../contracts"
import type { MockDb } from "./seed"
import { buscar, leerComoDataUrl, normalizar, nuevoId, run } from "./store"

/** Tamaño máximo de adjunto en modo demo (se guarda en localStorage). */
const MAX_ADJUNTO_MB = 1

function resumen(db: MockDb, t: Tarea): TareaResumen {
  const taller = t.tallerId ? db.talleres.find((x) => x.id === t.tallerId) : undefined
  return {
    ...t,
    empresaNombre: db.empresas.find((x) => x.id === t.empresaId)?.razonSocial ?? "—",
    yacimientoNombre: db.yacimientos.find((x) => x.id === t.yacimientoId)?.nombre ?? "—",
    plantaNombre: db.plantas.find((x) => x.id === t.plantaId)?.nombre ?? "—",
    equipoNombre: db.equipos.find((x) => x.id === t.equipoId)?.nombre ?? "—",
    tallerNombre: taller?.nombre,
    tallerColor: taller?.color,
  }
}

/** Valida que la ubicación sea coherente (el equipo pertenece a la planta, etc.). */
function validarUbicacion(
  db: MockDb,
  t: Pick<Tarea, "empresaId" | "yacimientoId" | "plantaId" | "equipoId">,
) {
  const yac = db.yacimientos.find((y) => y.id === t.yacimientoId)
  const pla = db.plantas.find((p) => p.id === t.plantaId)
  const equ = db.equipos.find((e) => e.id === t.equipoId)
  if (
    !yac ||
    !pla ||
    !equ ||
    yac.empresaId !== t.empresaId ||
    pla.yacimientoId !== yac.id ||
    equ.plantaId !== pla.id
  ) {
    throw new ServiceError("La ubicación de la tarea no es válida", "invalid")
  }
}

const ordenAgenda = (a: Tarea, b: Tarea) =>
  a.fechaEjecucion.localeCompare(b.fechaEjecucion) ||
  (a.horario ?? "99").localeCompare(b.horario ?? "99") ||
  a.nroSolicitud - b.nroSolicitud

export const tareas: TareasRepo = {
  list: (f = {}) =>
    run((db) => {
      const q = normalizar(f.q?.trim() ?? "")
      return db.tareas
        .filter((t) => !f.desde || t.fechaEjecucion >= f.desde)
        .filter((t) => !f.hasta || t.fechaEjecucion <= f.hasta)
        .filter((t) => !f.estados?.length || f.estados.includes(t.estado))
        .filter((t) =>
          !f.tallerId
            ? true
            : f.tallerId === "sin_asignar"
              ? !t.tallerId
              : t.tallerId === f.tallerId,
        )
        .filter((t) => !f.empresaId || t.empresaId === f.empresaId)
        .map((t) => resumen(db, t))
        .filter(
          (t) =>
            !q ||
            String(t.nroSolicitud).includes(q) ||
            [
              t.contacto,
              t.detalle,
              t.empresaNombre,
              t.plantaNombre,
              t.equipoNombre,
              t.yacimientoNombre,
            ].some((c) => normalizar(c).includes(q)),
        )
        .sort(ordenAgenda)
    }),
  get: (id) => run((db) => resumen(db, buscar(db.tareas, id, "Tarea"))),
  create: (data) =>
    run(
      (db) => {
        validarUbicacion(db, data)
        db.secuencias.solicitud += 1
        const tarea: Tarea = {
          ...data,
          id: nuevoId("tar"),
          nroSolicitud: db.secuencias.solicitud,
          estado: normalizarEstadoTarea(data.estado, data.tallerId),
        }
        db.tareas.push(tarea)
        return tarea
      },
      { escribe: true },
    ),
  update: (id, data) =>
    run(
      (db) => {
        const tarea = buscar(db.tareas, id, "Tarea")
        const next = { ...tarea, ...data }
        // `tallerId: undefined` explícito significa desasignar.
        if ("tallerId" in data && !data.tallerId) delete next.tallerId
        validarUbicacion(db, next)
        if (next.fechaEjecucion < next.fechaSolicitud) {
          throw new ServiceError(
            "La fecha de ejecución no puede ser anterior a la fecha de solicitud",
            "invalid",
          )
        }
        next.estado = normalizarEstadoTarea(next.estado, next.tallerId)
        db.tareas[db.tareas.indexOf(tarea)] = next
        return next
      },
      { escribe: true },
    ),
  subirAdjunto: async (archivo) => {
    if (archivo.size > MAX_ADJUNTO_MB * 1024 * 1024) {
      throw new ServiceError(
        `En modo demo los adjuntos pueden pesar hasta ${MAX_ADJUNTO_MB} MB`,
        "invalid",
      )
    }
    const url = await leerComoDataUrl(archivo)
    return run(() => ({
      id: nuevoId("adj"),
      nombre: archivo.name,
      tipo: archivo.type || "application/octet-stream",
      url,
    }))
  },
}

const iso = (d: Date) => format(d, "yyyy-MM-dd")

export const cronograma: CronogramaRepo = {
  nominas: (desde, hasta) =>
    run((db) => db.nominas.filter((n) => n.fecha >= desde && n.fecha <= hasta)),
  setNomina: (tallerId, fecha, personaIds) =>
    run(
      (db) => {
        buscar(db.talleres, tallerId, "Taller")
        db.nominas = db.nominas.filter((n) => !(n.tallerId === tallerId && n.fecha === fecha))
        if (personaIds.length) db.nominas.push({ tallerId, fecha, personaIds: [...personaIds] })
      },
      { escribe: true },
    ),
  copiarSemanaAnterior: (lunes) =>
    run(
      (db) => {
        let copiadas = 0
        for (let d = 0; d < 7; d++) {
          const destino = iso(addDays(parseISO(lunes), d))
          const origen = iso(addDays(parseISO(lunes), d - 7))
          for (const n of db.nominas.filter((x) => x.fecha === origen)) {
            const ocupada = db.nominas.some((x) => x.fecha === destino && x.tallerId === n.tallerId)
            if (!ocupada) {
              db.nominas.push({ ...n, fecha: destino, personaIds: [...n.personaIds] })
              copiadas++
            }
          }
        }
        return copiadas
      },
      { escribe: true },
    ),
}
