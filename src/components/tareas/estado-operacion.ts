import type { EstadoTarea } from "../../lib/domain/types"
import type { OperationStatus } from "../../lib/api/operations"

/** Tarea is a presentation of the canonical Visita state. */
export const ESTADO_OPERACION_A_TAREA: Record<OperationStatus, EstadoTarea> = {
  solicitada: "pendiente",
  programada: "programada",
  aceptada: "aceptada",
  en_curso: "en_curso",
  completada: "completada",
  cancelada: "cancelada",
}

export const puedeCancelarVisitaAdministrativa = (estado: OperationStatus) =>
  estado === "programada" || estado === "aceptada"

export const puedeEditarProgramacion = (estado: OperationStatus) => estado === "programada"
