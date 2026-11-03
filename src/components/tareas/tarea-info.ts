import type { TareaResumen } from "@/lib/services"
import { resumenPlantas } from "@/lib/services/ubicacion-operacion"

/** El mapeo histórico rellena los datos que no tiene con «—»: se trata como vacío. */
const limpio = (valor: string | undefined) => {
  const texto = valor?.trim() ?? ""
  return texto === "—" ? "" : texto
}

function locacion(t: TareaResumen) {
  return t.plantasNombres?.length ? resumenPlantas(t.plantasNombres) : limpio(t.plantaNombre)
}

/** Líneas de la tarjeta del cronograma; las vacías no se muestran. */
export function infoCronograma(t: TareaResumen) {
  return {
    yacimiento: limpio(t.yacimientoNombre),
    locacion: locacion(t),
    contacto: limpio(t.contacto),
    telefono: limpio(t.telefono),
  }
}

/** Datos extra de la tarjeta de la agenda: taller móvil asignado, planta, contacto y teléfono. */
export function infoAgenda(t: TareaResumen) {
  return {
    taller: limpio(t.tallerNombre) || "Sin asignar",
    planta: locacion(t),
    contacto: limpio(t.contacto),
    telefono: limpio(t.telefono),
    detalle: limpio(t.detalle),
  }
}

/** Enlace `tel:` para llamar desde el celular; `undefined` si el texto no tiene dígitos. */
export function telefonoHref(telefono: string): string | undefined {
  const digitos = telefono.replace(/\D/g, "")
  if (!digitos) return undefined
  return `tel:${telefono.trim().startsWith("+") ? "+" : ""}${digitos}`
}
