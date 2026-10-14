import { LoaderCircle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Indicador de carga compartido ("ruedita"). Lo usan los `loading.tsx` de cada sección y las
 * pantallas mientras sus consultas de TanStack Query están pendientes.
 *
 * - `role="status"` + `aria-live` anuncian la carga a lectores de pantalla.
 * - Aparece con un breve retardo para no parpadear cuando la respuesta es inmediata.
 * - Con movimiento reducido la rueda queda quieta y el texto se muestra visible.
 */
export function Cargando({
  texto = "Cargando…",
  variante = "seccion",
  className,
}: {
  /** Texto para lectores de pantalla (y visible con movimiento reducido o en la variante `linea`). */
  texto?: string
  /** `seccion` centra la rueda en el área de contenido; `linea` la muestra junto al texto. */
  variante?: "seccion" | "linea"
  className?: string
}) {
  const linea = variante === "linea"
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "cargando-aparece flex items-center text-muted-foreground",
        linea ? "gap-2 py-2 text-sm" : "min-h-48 flex-1 flex-col justify-center gap-3 py-12",
        className,
      )}
    >
      <LoaderCircle
        aria-hidden
        className={cn(
          "shrink-0 animate-spin text-primary motion-reduce:animate-none",
          linea ? "size-4" : "size-8",
        )}
      />
      <span className={cn("text-sm", !linea && "sr-only motion-reduce:not-sr-only")}>{texto}</span>
    </div>
  )
}
