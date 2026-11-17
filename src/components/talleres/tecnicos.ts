/** Persona de la nómina tal como llega en `assigned_technicians` del contexto de la visita. */
export type TecnicoAsignado = {
  id?: string
  name?: string
  nombre?: string
  apellido?: string
}

/**
 * Nombre completo del técnico («nombre apellido»), que es lo que se ofrece en el selector y se
 * imprime en el certificado. El backend ya no lo valida contra la nómina: puede firmar cualquier
 * técnico, incluido un reemplazante.
 */
export function nombreDeTecnico(persona: TecnicoAsignado): string {
  const completo = persona.name ?? [persona.nombre, persona.apellido].filter(Boolean).join(" ")
  return completo.replace(/\s+/g, " ").trim()
}
