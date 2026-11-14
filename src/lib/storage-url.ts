/**
 * El Storage local firma las URL con el host interno del stack (`http://kong:8000`), que el
 * navegador no alcanza: se las sirve desde la URL pública de Supabase. Solo toca URLs firmadas
 * por http (`/storage/v1/object/sign/…`); en producción llegan por https con el host público y
 * quedan igual. Toda URL firmada de Storage que se muestre (logo del Cliente, adjuntos, imágenes
 * del certificado) pasa por acá.
 */
export function urlPublicaDeStorage(
  url: string,
  publica: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string {
  if (!publica) return url
  try {
    const original = new URL(url)
    if (original.protocol !== "http:" || !original.pathname.startsWith("/storage/v1/object/sign/"))
      return url
    return new URL(`${original.pathname}${original.search}`, publica).toString()
  } catch {
    return url
  }
}
