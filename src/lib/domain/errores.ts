/**
 * Traducción de los errores de negocio y de restricciones de Postgres que llegan crudos (en inglés)
 * desde las Edge Functions. Función pura: los mensajes desconocidos se devuelven sin cambios.
 */

/** Mensajes exactos que levantan los RPC del flujo de solicitudes y visitas. */
const MENSAJES: Readonly<Record<string, string>> = {
  // Solicitudes de servicio
  "Cliente not found": "El Cliente no existe o está deshabilitado.",
  "The target account is not an active Cliente":
    "La cuenta del Cliente está deshabilitada: reactívala antes de cargar su estructura.",
  "The selected Cliente does not own the Yacimiento":
    "El yacimiento elegido no pertenece al Cliente.",
  "Service request not found": "No se encontró la solicitud de servicio.",
  "At least one service selection is required": "Selecciona al menos un equipo o válvula.",
  "Service selection is outside the Yacimiento":
    "La selección no pertenece al yacimiento de la solicitud.",
  "A visit requires at least one selected Válvula": "La visita necesita al menos una válvula.",
  "Invalid request attachment reference":
    "Un adjunto no es válido o no terminó de subirse. Vuelve a adjuntarlo.",
  "An accepted service request cannot be scheduled":
    "La solicitud ya fue aceptada por un taller: cambia la fecha o el taller desde la visita.",
  "An existing visit must be changed through visit administration":
    "La solicitud ya tiene una visita: cambia la fecha o el taller desde la visita.",
  "A visit window requires a Taller Móvil":
    "Para programar la visita hay que elegir un taller móvil.",
  // Visitas de servicio
  "Visit not found": "No se encontró la visita.",
  "Taller Móvil not found": "No se encontró el taller móvil.",
  "A visit requires a valid date and time window": "La fecha u horario de la visita no es válido.",
  "A rescheduled visit requires both start and end times":
    "La fecha u horario de la visita no es válido.",
  "The assignment and schedule are unchanged":
    "No hay cambios de taller ni de horario para guardar.",
  "The schedule is unchanged": "No hay cambios de fecha ni de horario para guardar.",
  "Only an unassigned scheduled visit can be assigned":
    "Solo se puede asignar un taller a una visita programada que no tenga uno.",
  "Only an assigned visit that has not started can be unassigned":
    "Solo se puede desasignar una visita con taller que todavía no empezó.",
  "Only an assigned visit that has not started can be reassigned":
    "Solo se puede reasignar una visita con taller que todavía no empezó.",
  "Only a visit that has not started can be rescheduled":
    "Solo se puede reprogramar una visita que todavía no fue aceptada ni empezó.",
  "Only a visit that has not started can be cancelled by an Administrador":
    "Solo se puede cancelar una visita que todavía no empezó.",
  "Only a cancelled visit can be restored": "Solo se puede reabrir una visita cancelada.",
  "A visit can only be cancelled before its execution day and before work starts":
    "La visita solo se puede cancelar antes del día de ejecución y antes de que empiece el trabajo.",
  "Only a scheduled visit can be accepted": "Solo se puede aceptar una visita programada.",
  // Visitas de seguimiento
  "Only an accepted service request can have a follow-up visit":
    "Solo se puede programar una visita de seguimiento en una solicitud aceptada.",
  "Only a completed visit can generate a follow-up visit":
    "Solo una visita completada puede generar una visita de seguimiento.",
  "Source visit not found in this Solicitud": "La visita de origen no pertenece a esta solicitud.",
  "Select one or more distinct Válvulas for the follow-up visit":
    "Selecciona una o más válvulas distintas para la visita de seguimiento.",
  "Every selected Válvula must have a no_evaluada Orden de trabajo in the source visit":
    "Todas las válvulas elegidas deben haber quedado sin evaluar en la visita de origen.",
  "A Válvula is already assigned to another active visit in this Solicitud":
    "Una de las válvulas ya está en otra visita activa de esta solicitud.",
  // Cierre de la visita y firmas (Taller)
  "Every evaluated work order requires a complete certificate before visit completion":
    "Cada válvula evaluada necesita su certificado completo antes de completar la visita.",
  "A visit signature cannot be replaced":
    "La firma de la visita ya fue registrada y no se puede reemplazar.",
  "An Administrador cannot accept a visit-signature operation; reject it or authorize a certificate correction":
    "Una firma no se puede aceptar: usá «Rechazar» o autorizá una corrección del certificado.",
  "Only an in-progress visit can be completed": "Solo se puede completar una visita en curso.",
  "An offline operation dependency is not synchronized":
    "Hay un cambio previo de la visita que todavía no se sincronizó.",
  "A Técnico signature is required to complete a visit":
    "Falta la firma del Técnico para completar la visita.",
  "The Técnico is not assigned to this visit Taller Móvil":
    "El técnico no figura en la nómina del taller para el día de la visita.",
  "The Técnico is not assigned to the visit Taller Móvil":
    "El técnico no figura en la nómina del taller para el día de la visita.",
  "An in-person Cliente signature must be captured before the Técnico signature":
    "Primero hay que registrar la firma presencial del Cliente y después la del Técnico.",
  "Certificate drafts can be started only while the visit is in progress":
    "El borrador del certificado solo se puede iniciar con la visita en curso.",
  "Certificate capture is closed": "La captura del certificado ya está cerrada.",
  "An expired certificate cannot be downloaded by the Cliente":
    "El certificado está vencido y ya no se puede descargar.",
  // Fotos y Parte Diario
  "Unsupported storage content type":
    "El formato de la imagen no es compatible. Usá una foto JPG, PNG o WEBP.",
  "Invalid storage object size": "La imagen está vacía o pesa más de 10 MB. Probá con otra foto.",
  "A Parte diario image file is required": "Elegí la foto del Parte Diario antes de adjuntarla.",
  "A valid alphanumeric Parte diario code is required":
    "El número de Parte Diario debe ser alfanumérico (sin espacios ni símbolos).",
  // Cuenta
  "Cuenta is not active": "Tu cuenta no está activa.",
}

/** Restricciones con nombre propio, detectadas dentro del mensaje de Postgres. */
const RESTRICCIONES: ReadonlyArray<readonly [string, string]> = [
  [
    "visita_equipos_no_simultaneous_equipment",
    "El equipo ya tiene otra visita en ese horario. Elige otro día u horario.",
  ],
]

/** Patrones genéricos, evaluados después de los mensajes exactos y las restricciones. */
const PATRONES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /violates exclusion constraint/i,
    "El horario se superpone con otra visita. Elige otro horario.",
  ],
  [
    /^Only an active Administrador can /,
    "Solo un administrador activo puede realizar esta acción.",
  ],
]

export function traducirMensajeError(mensaje: string): string {
  const exacto = MENSAJES[mensaje.trim()]
  if (exacto) return exacto
  for (const [restriccion, traduccion] of RESTRICCIONES)
    if (mensaje.includes(restriccion)) return traduccion
  for (const [patron, traduccion] of PATRONES) if (patron.test(mensaje)) return traduccion
  return mensaje
}
