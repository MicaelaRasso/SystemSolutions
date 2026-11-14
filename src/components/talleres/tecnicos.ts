/** Persona de la nómina tal como llega en `assigned_technicians` del contexto de la visita. */
export type TecnicoAsignado = {
  id?: string
  name?: string
  nombre?: string
  apellido?: string
}

/**
 * Nombre completo del técnico. La firma del Técnico se valida contra «nombre apellido» de la
 * nómina (`api_technician_name_is_member`), así que el selector debe ofrecer el nombre completo.
 */
export function nombreDeTecnico(persona: TecnicoAsignado): string {
  const completo = persona.name ?? [persona.nombre, persona.apellido].filter(Boolean).join(" ")
  return completo.replace(/\s+/g, " ").trim()
}
