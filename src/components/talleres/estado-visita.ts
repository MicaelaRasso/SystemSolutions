import type { VisitaOffline } from "@/lib/offline/sync"

/**
 * La visita ya se inició: está en curso (en el dispositivo o en el servidor) o se completó sin
 * conexión. Una visita completada localmente sigue el estado del servidor (`aceptada` o
 * `en_curso`) hasta sincronizar; sin contarla como iniciada, la tarjeta volvía a ofrecer «Iniciar
 * Visita de servicio» y ocultaba el Parte Diario, las firmas y el aviso de borradores cerrados.
 */
export function visitaIniciada(
  visit: Pick<VisitaOffline, "estadoLocal" | "backendStatus">,
  estadoContexto?: unknown,
): boolean {
  return (
    visit.estadoLocal === "completada_local" ||
    visit.estadoLocal === "en_curso_local" ||
    visit.backendStatus === "en_curso" ||
    estadoContexto === "en_curso" ||
    visitaRequiereFinalizacion(visit, estadoContexto)
  )
}

/**
 * La visita venció en el servidor (E4): quedó en «Requiere finalización». El trabajo de campo ya no
 * se edita desde el panel; solo se cargan en línea las firmas que falten.
 */
export function visitaRequiereFinalizacion(
  visit: Pick<VisitaOffline, "backendStatus">,
  estadoContexto?: unknown,
): boolean {
  return (
    visit.backendStatus === "requiere_finalizacion" || estadoContexto === "requiere_finalizacion"
  )
}

/** Estado de la visita según el contexto guardado en el dispositivo (la fila de la visita). */
function estadoDelContexto(visit: Pick<VisitaOffline, "context">): unknown {
  const contexto = visit.context as { visit?: { estado?: unknown } } | null | undefined
  return contexto?.visit?.estado
}

/**
 * La visita sigue abierta en el taller: se inició (en el dispositivo o en el servidor) y no se
 * completó ni quedó en «Requiere finalización». Una completada sin conexión ya no cuenta: al
 * sincronizar se completa antes de que llegue el inicio de la siguiente.
 */
export function visitaEnCurso(
  visit: Pick<VisitaOffline, "estadoLocal" | "backendStatus" | "context">,
): boolean {
  const estadoContexto = estadoDelContexto(visit)
  if (visit.estadoLocal === "completada_local") return false
  if (visitaRequiereFinalizacion(visit, estadoContexto)) return false
  if (visit.backendStatus === "completada" || estadoContexto === "completada") return false
  return (
    visit.estadoLocal === "en_curso_local" ||
    visit.backendStatus === "en_curso" ||
    estadoContexto === "en_curso"
  )
}

/**
 * Otra visita del taller que sigue en curso. Un Taller Móvil es una sola cuadrilla: atiende una
 * visita a la vez, así que no puede iniciar otra hasta completar esta (el servidor también lo
 * rechaza).
 */
export function otraVisitaEnCurso<
  T extends Pick<VisitaOffline, "id" | "estadoLocal" | "backendStatus" | "context">,
>(visitas: readonly T[], visitId: string): T | undefined {
  return visitas.find((visita) => visita.id !== visitId && visitaEnCurso(visita))
}
