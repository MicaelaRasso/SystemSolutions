"use client"

import { addMonths, isSameMonth, isToday, subMonths } from "date-fns"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { diasGrillaMes, fmt, fmtDiaLargo, iso } from "@/lib/fechas"
import { cn } from "@/lib/utils"

const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]

export interface MonthCalendarProps<T> {
  mes: Date
  onMesChange: (mes: Date) => void
  items: T[]
  claveDe: (item: T) => string
  fechaDe: (item: T) => string
  /** Color del punto en la vista compacta (celular). */
  colorDe: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  /** Si se define, cada día muestra un botón "+" para crear en esa fecha. */
  onNuevo?: (fecha: string) => void
  maxPorDia?: number
  acciones?: React.ReactNode
  cargando?: boolean
}

/**
 * Calendario mensual tipo almanaque (RF-39). En pantallas chicas muestra puntos por día
 * y la lista del día elegido debajo de la grilla.
 */
export function MonthCalendar<T>({
  mes,
  onMesChange,
  items,
  claveDe,
  fechaDe,
  colorDe,
  renderItem,
  onNuevo,
  maxPorDia = 3,
  acciones,
  cargando,
}: MonthCalendarProps<T>) {
  const dias = useMemo(() => diasGrillaMes(mes), [mes])
  const porDia = useMemo(() => {
    const m = new Map<string, T[]>()
    for (const it of items) {
      const k = fechaDe(it)
      m.set(k, [...(m.get(k) ?? []), it])
    }
    return m
  }, [items, fechaDe])
  const [seleccionado, setSeleccionado] = useState<string>(iso(new Date()))
  const delDia = porDia.get(seleccionado) ?? []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-44 text-lg font-semibold capitalize">{fmt(mes, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Mes anterior"
            onClick={() => onMesChange(subMonths(mes, 1))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => onMesChange(new Date())}>
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Mes siguiente"
            onClick={() => onMesChange(addMonths(mes, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">{acciones}</div>
      </div>

      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card transition-opacity",
          cargando && "opacity-60",
        )}
      >
        <div className="grid grid-cols-7 border-b bg-muted/50 text-center text-xs font-medium text-muted-foreground">
          {DIAS.map((d) => (
            <div key={d} className="py-2 capitalize">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {dias.map((d, i) => {
            const k = iso(d)
            const lista = porDia.get(k) ?? []
            const fuera = !isSameMonth(d, mes)
            const hoy = isToday(d)
            const visibles = lista.slice(0, maxPorDia)
            const resto = lista.length - visibles.length
            return (
              <div
                key={k}
                className={cn(
                  "group relative flex min-h-14 flex-col gap-1 border-b p-1 md:min-h-32 md:p-1.5",
                  i % 7 !== 6 && "border-r",
                  fuera && "bg-muted/30",
                  k === seleccionado && "max-md:bg-accent",
                )}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setSeleccionado(k)}
                    aria-label={`${fmtDiaLargo(d)}: ${lista.length} ${lista.length === 1 ? "tarea" : "tareas"}`}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                      fuera && "text-muted-foreground",
                      hoy && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {d.getDate()}
                  </button>
                  {onNuevo && (
                    <button
                      type="button"
                      onClick={() => onNuevo(k)}
                      aria-label={`Nueva tarea el ${fmtDiaLargo(d)}`}
                      className="hidden size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 md:flex"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Celular: puntos */}
                <button
                  type="button"
                  onClick={() => setSeleccionado(k)}
                  className="flex flex-wrap gap-0.5 md:hidden"
                  tabIndex={-1}
                  aria-hidden
                >
                  {lista.slice(0, 6).map((it) => (
                    <span
                      key={claveDe(it)}
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: colorDe(it) }}
                    />
                  ))}
                </button>

                {/* Escritorio: tarjetas */}
                <div className="hidden min-w-0 flex-col gap-1 md:flex">
                  {visibles.map((it) => (
                    <div key={claveDe(it)} className="min-w-0">
                      {renderItem(it)}
                    </div>
                  ))}
                  {resto > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="rounded px-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          +{resto} más
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 space-y-1 p-2" align="start">
                        <p className="px-1 pb-1 text-sm font-medium capitalize">{fmtDiaLargo(d)}</p>
                        {lista.map((it) => (
                          <div key={claveDe(it)}>{renderItem(it)}</div>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Celular: lista del día elegido */}
      <section className="space-y-2 md:hidden" aria-label="Día seleccionado">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium capitalize">{fmtDiaLargo(seleccionado)}</h3>
          {onNuevo && (
            <Button size="sm" variant="outline" onClick={() => onNuevo(seleccionado)}>
              <Plus />
              Nueva
            </Button>
          )}
        </div>
        {delDia.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Sin tareas este día
          </p>
        ) : (
          delDia.map((it) => <div key={claveDe(it)}>{renderItem(it)}</div>)
        )}
      </section>
    </div>
  )
}
