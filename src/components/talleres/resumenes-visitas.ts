import { edgeApi } from "@/lib/api"
import type { OperationSummary } from "@/lib/api/contracts"

import type { ResumenVisita } from "./visita-titulo"

const TAMANO_PAGINA = 100
const MAX_PAGINAS = 3

/** Se guarda solo lo necesario para rotular la visita, no el resumen completo. */
export function resumenDeOperacion(operacion: OperationSummary): ResumenVisita {
  return {
    cliente: { nombre: operacion.cliente.nombre },
    yacimiento: { nombre: operacion.yacimiento.nombre },
    ...(operacion.plantas ? { plantas: operacion.plantas.map((planta) => ({ nombre: planta.nombre })) } : {}),
    ...(operacion.contacto ? { contacto: operacion.contacto } : {}),
    ...(operacion.telefono ? { telefono: operacion.telefono } : {}),
    ...(operacion.pd_rto ? { pdRto: operacion.pd_rto } : {}),
    numeroSolicitud: operacion.numero_solicitud,
  }
}

/** Número de Parte Diario sugerido a partir del PD/RTO de la tarea, con el formato que acepta el PD. */
export function codigoPdSugerido(resumen: ResumenVisita | undefined): string {
  return (resumen?.pdRto ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase()
}

/**
 * Consulta las operaciones vigentes del taller y devuelve un resumen por id de visita (el id de la
 * operación es el de la visita). Es de mejor esfuerzo: si falla, el panel sigue con el rótulo de
 * respaldo y no muestra ningún error.
 */
export async function cargarResumenesDeVisitas(): Promise<Map<string, ResumenVisita>> {
  const resumenes = new Map<string, ResumenVisita>()
  try {
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const respuesta = await edgeApi.operations.list({
        status: ["programada", "aceptada", "en_curso"],
        limit: TAMANO_PAGINA,
        offset: pagina * TAMANO_PAGINA,
      })
      for (const operacion of respuesta.items) resumenes.set(operacion.id, resumenDeOperacion(operacion))
      if (!respuesta.has_more) break
    }
  } catch {
    // Sin conexión o sin permiso: se usan los rótulos de respaldo.
  }
  return resumenes
}

const CLAVE_CONTEXTO = "operation_summary"

/** Lee el resumen que quedó guardado junto con la visita en IndexedDB (permite rotular sin conexión). */
export function resumenGuardado(context: unknown): ResumenVisita | undefined {
  if (!context || typeof context !== "object") return undefined
  const valor = (context as Record<string, unknown>)[CLAVE_CONTEXTO]
  return valor && typeof valor === "object" ? (valor as ResumenVisita) : undefined
}

/** Agrega el resumen al contexto que se persiste, conservando el anterior si ahora no hay uno nuevo. */
export function conResumenGuardado<T extends object>(
  context: T,
  nuevo: ResumenVisita | undefined,
  anterior: unknown,
): T & { operation_summary?: ResumenVisita } {
  const resumen = nuevo ?? resumenGuardado(anterior)
  return resumen ? { ...context, [CLAVE_CONTEXTO]: resumen } : context
}
