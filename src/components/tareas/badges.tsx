import { Badge } from "@/components/ui/badge"
import { ESTADO_TAREA_LABEL } from "@/lib/domain/rules"
import type { EstadoTarea } from "@/lib/domain/types"
import { cn } from "@/lib/utils"

const ESTILO: Record<EstadoTarea, string> = {
  pendiente: "bg-amber-100 text-amber-900",
  asignada: "bg-sky-100 text-sky-800",
  en_curso: "bg-violet-100 text-violet-800",
  completada: "bg-emerald-100 text-emerald-800",
  cancelada: "bg-zinc-200 text-zinc-600 line-through",
}

export function EstadoTareaBadge({ estado }: { estado: EstadoTarea }) {
  return (
    <Badge className={cn("border-transparent", ESTILO[estado])}>{ESTADO_TAREA_LABEL[estado]}</Badge>
  )
}

/** Color neutro para tareas sin taller asignado. */
export const COLOR_SIN_TALLER = "#a1a1aa"

export function TallerChip({
  nombre,
  color,
  className,
}: {
  nombre?: string
  color?: string
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm", className)}>
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color ?? COLOR_SIN_TALLER }}
        aria-hidden
      />
      <span className={cn("truncate", !nombre && "text-muted-foreground italic")}>
        {nombre ?? "Sin asignar"}
      </span>
    </span>
  )
}
