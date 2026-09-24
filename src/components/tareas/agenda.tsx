"use client"

import { Plus } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

import { MonthCalendar } from "@/components/common/month-calendar"
import { PageHeader } from "@/components/common/page-header"
import { ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { diasGrillaMes, iso } from "@/lib/fechas"
import { useTalleres, useTareas } from "@/lib/hooks/queries"
import type { TareaResumen } from "@/lib/services"
import { cn } from "@/lib/utils"

import { COLOR_SIN_TALLER } from "./badges"
import { TareaSheet } from "./tarea-sheet"

const SIN_TALLER = "sin_asignar"

/** Agenda mensual de tareas por taller móvil (RF-10, RF-11, RF-12). */
export function Agenda() {
  const router = useRouter()
  const [mes, setMes] = useState(() => new Date())
  const [ocultos, setOcultos] = useState<Set<string>>(new Set())
  const [verCanceladas, setVerCanceladas] = useState(false)
  const [abierta, setAbierta] = useState<TareaResumen | null>(null)

  const dias = useMemo(() => diasGrillaMes(mes), [mes])
  const tareas = useTareas({ desde: iso(dias[0]), hasta: iso(dias[dias.length - 1]) })
  const talleres = useTalleres()

  const visibles = (tareas.data ?? []).filter(
    (t) => (verCanceladas || t.estado !== "cancelada") && !ocultos.has(t.tallerId ?? SIN_TALLER),
  )

  function alternar(id: string) {
    setOcultos((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const fechaDe = useCallback((t: TareaResumen) => t.fechaEjecucion, [])
  const leyenda = [
    ...(talleres.data ?? [])
      .filter((t) => t.activo)
      .map((t) => ({ id: t.id, nombre: t.nombre, color: t.color })),
    { id: SIN_TALLER, nombre: "Sin asignar", color: COLOR_SIN_TALLER },
  ]

  return (
    <>
      <PageHeader
        titulo="Agenda"
        descripcion="Tareas programadas por día. Tocá una tarea para ver su detalle."
        acciones={
          <Button asChild>
            <Link href="/admin/tareas/nueva">
              <Plus />
              Nueva tarea
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar por taller">
        {leyenda.map((l) => {
          const activo = !ocultos.has(l.id)
          return (
            <button
              key={l.id}
              type="button"
              aria-pressed={activo}
              onClick={() => alternar(l.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition",
                activo ? "bg-card" : "bg-muted text-muted-foreground line-through opacity-70",
              )}
            >
              <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} />
              {l.nombre}
            </button>
          )
        })}
        <div className="ml-auto flex items-center gap-2">
          <Switch id="canceladas" checked={verCanceladas} onCheckedChange={setVerCanceladas} />
          <Label htmlFor="canceladas" className="font-normal">
            Mostrar canceladas
          </Label>
        </div>
      </div>

      {tareas.isError ? (
        <ErrorState error={tareas.error} onRetry={() => tareas.refetch()} />
      ) : (
        <MonthCalendar
          mes={mes}
          onMesChange={setMes}
          items={visibles}
          claveDe={(t) => t.id}
          fechaDe={fechaDe}
          colorDe={(t) => t.tallerColor ?? COLOR_SIN_TALLER}
          cargando={tareas.isPending || tareas.isPlaceholderData}
          onNuevo={(fecha) => router.push(`/admin/tareas/nueva?fecha=${fecha}`)}
          renderItem={(t) => <TareaPill tarea={t} onClick={() => setAbierta(t)} />}
        />
      )}

      <TareaSheet tarea={abierta} onOpenChange={(o) => !o && setAbierta(null)} />
    </>
  )
}

/** Tarjeta compacta: horario, cliente y locación (RF-11). */
function TareaPill({ tarea, onClick }: { tarea: TareaResumen; onClick: () => void }) {
  const color = tarea.tallerColor ?? COLOR_SIN_TALLER
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tarea.horario ?? ""} ${tarea.empresaNombre} · ${tarea.plantaNombre}`}
      className={cn(
        "w-full rounded-md border-l-3 px-1.5 py-1 text-left text-xs leading-tight transition hover:brightness-95",
        tarea.estado === "cancelada" && "line-through opacity-60",
        tarea.estado === "completada" && "opacity-75",
      )}
      style={{ borderLeftColor: color, backgroundColor: `${color}1a` }}
    >
      <span className="block truncate font-medium">
        {tarea.horario && <span className="tabular-nums">{tarea.horario} </span>}
        {tarea.empresaNombre}
      </span>
      <span className="block truncate text-muted-foreground">{tarea.plantaNombre}</span>
    </button>
  )
}
