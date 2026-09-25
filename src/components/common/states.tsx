import { AlertTriangle, Construction, Inbox, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { mensajeError } from "@/lib/hooks/queries"
import { cn } from "@/lib/utils"

export function EmptyState({
  icono: Icono = Inbox,
  titulo,
  descripcion,
  accion,
  className,
}: {
  icono?: LucideIcon
  titulo: string
  descripcion?: string
  accion?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center",
        className,
      )}
    >
      <div className="rounded-full bg-muted p-3">
        <Icono className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{titulo}</p>
        {descripcion && <p className="max-w-sm text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      {accion}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-6 text-destructive" />
      <div className="space-y-1">
        <p className="font-medium">No se pudo cargar la información</p>
        <p className="text-sm text-muted-foreground">{mensajeError(error)}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}

/** Marcador para secciones planificadas en fases posteriores (ver planning.md). */
export function EnConstruccion({
  titulo,
  fase,
  detalle,
}: {
  titulo: string
  fase: number
  detalle: string
}) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <EmptyState
        icono={Construction}
        titulo={`Disponible en la fase ${fase}`}
        descripcion={detalle}
      />
    </div>
  )
}
