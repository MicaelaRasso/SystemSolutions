/** Lista de fotos del Parte Diario que ve el Técnico en la tarjeta de la visita. */

/** Foto adjuntada en esta sesión: se muestra con su miniatura local (`blob:`). */
export type FotoParteDiarioSesion = {
  id: string
  nombre: string
  url: string
  /** Guardada sin conexión, todavía sin subir. */
  pendiente: boolean
}

export type FotoParteDiarioListada =
  | { id: string; numero: number; origen: "remota" }
  | { id: string; numero: number; origen: "sesion"; foto: FotoParteDiarioSesion }

export function idsDeImagenes(images: unknown): string[] {
  if (!Array.isArray(images)) return []
  return images.flatMap((image) =>
    image && typeof image === "object" && typeof (image as { id?: unknown }).id === "string"
      ? [(image as { id: string }).id]
      : [],
  )
}

/** Primero las fotos que ya estaban en el servidor y después las de esta sesión, sin repetir. */
export function listarFotosParteDiario(
  remotas: readonly string[],
  sesion: readonly FotoParteDiarioSesion[],
): FotoParteDiarioListada[] {
  const deSesion = new Set(sesion.map((foto) => foto.id))
  const previas = remotas.filter((id) => !deSesion.has(id))
  return [
    ...previas.map((id, indice) => ({ id, numero: indice + 1, origen: "remota" as const })),
    ...sesion.map((foto, indice) => ({
      id: foto.id,
      numero: previas.length + indice + 1,
      origen: "sesion" as const,
      foto,
    })),
  ]
}

/** El formato «N foto(s)» lo buscan los e2e (`e2e/support/taller.ts`). */
export function textoCantidadFotos(cantidad: number): string {
  return cantidad > 0
    ? `${cantidad} foto(s) del Parte Diario adjunta(s).`
    : "Todavía no hay fotos del Parte Diario."
}
