import { cn } from "@/lib/utils"

export function PageHeader({
  titulo,
  descripcion,
  acciones,
  className,
}: {
  titulo: React.ReactNode
  descripcion?: React.ReactNode
  acciones?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion && <p className="text-sm text-muted-foreground">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  )
}
