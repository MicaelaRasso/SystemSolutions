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
    estadoContexto === "en_curso"
  )
}
