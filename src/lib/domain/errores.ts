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
  "The selected Equipo has no Válvulas":
    "El equipo no tiene válvulas cargadas. Cargá al menos una antes de crear la tarea.",
  "A Técnico signature is required to complete a visit":
    "Falta la firma del Técnico para completar la visita.",
  "The Técnico is not assigned to this visit Taller Móvil":
    "Tu cuenta no pertenece al taller asignado a esta visita.",
  "The Técnico is not assigned to the visit Taller Móvil":
    "Tu cuenta no pertenece al taller asignado a esta visita.",
  "An in-person Cliente signature must be captured before the Técnico signature":
    "Primero hay que registrar la firma presencial del Cliente y después la del Técnico.",
  "Certificate drafts can be started only while the visit is in progress":
    "El borrador del certificado solo se puede iniciar con la visita en curso.",
  "Certificate capture is closed": "La captura del certificado ya está cerrada.",
  "An expired certificate cannot be downloaded by the Cliente":
    "El certificado está vencido y ya no se puede descargar.",
  // Válvulas agregadas o dadas de alta en campo (A1/A2)
  "Válvulas can be added only while the visit is in progress":
    "Solo se pueden agregar válvulas con la visita en curso.",
  "An added Válvula must belong to the same Cliente":
    "La válvula tiene que ser del mismo Cliente que la visita.",
  "The Taller Móvil requires active Yacimiento access":
    "El taller no tiene acceso al yacimiento de esa válvula.",
  "Válvula not found": "No se encontró la válvula.",
  "The work order id is already used by another Orden de trabajo":
    "Esa orden de trabajo ya existe con otra válvula. Volvé a agregar la válvula.",
  // Visita en «Requiere finalización» (E3/E4)
  "The visit was closed at the end of its day and requires finalization":
    "La visita venció a las 23:59 y quedó en «Requiere finalización»: el cambio quedó en conflicto para que lo revise el Administrador.",
  "Only an active Administrador can close a visit that requires finalization":
    "Solo un Administrador activo puede cerrar una visita que requiere finalización.",
  "A closing reason of 1 to 1000 characters is required":
    "Indicá el motivo del cierre (hasta 1000 caracteres).",
  "A closing reason is required (1 to 1000 characters)":
    "Indicá el motivo del cierre (hasta 1000 caracteres).",
  "Only a visit that requires finalization can be closed by an Administrador":
    "Solo se puede cerrar así una visita en «Requiere finalización».",
  "Resolve the synchronization conflicts of this visit before closing it":
    "La visita tiene conflictos de sincronización sin resolver: resolvelos antes de cerrarla.",
  "A follow-up visit for the unevaluated Válvulas requires a Taller Móvil and start/end times":
    "Quedan válvulas sin evaluar: elegí el taller, la fecha y el horario estimado de la visita de seguimiento.",
  "Correction resolution requires a Taller Móvil and visit start/end times":
    "Para autorizar la corrección hay que indicar el taller móvil y el inicio y fin estimado de la visita.",
  // Un Taller Móvil es una sola cuadrilla: una visita en curso a la vez.
  "The Taller Móvil already has a visit in progress; complete it before starting another":
    "El taller ya tiene otra visita en curso. Completá esa visita antes de iniciar esta: un taller atiende una visita a la vez.",
  "Válvulas can be created only while the visit is in progress":
    "Solo se pueden dar de alta válvulas con la visita en curso.",
  "A created Válvula must belong to the visit Cliente":
    "El equipo elegido no es del Cliente de la visita.",
  "Equipo not found": "No se encontró el equipo elegido.",
  "The Válvula id is already used by another Válvula":
    "Ese identificador ya pertenece a otra válvula. Volvé a cargar el alta.",
  "Asset name or tag must be alphanumeric":
    "El TAG debe empezar con una letra o un número y usar solo letras, números, espacios, puntos, guiones o barras.",
  "Operating pressure and temperature must be numbers":
    "La presión y la temperatura de operación tienen que ser números.",
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
    // 23P01: la visita reserva el equipo entre su inicio y su fin estimado (ADR 0008).
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
