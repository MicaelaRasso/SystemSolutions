"use client"

import { addMonths, isSameMonth, isToday, parseISO, subMonths } from "date-fns"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  /** Sustantivo de los elementos para textos accesibles y vacíos. */
  etiquetas?: { singular: string; plural: string; vacio: string }
  /**
   * En celular: "puntos" muestra la grilla con puntos y la lista del día elegido;
   * "agenda" reemplaza la grilla por la lista de días del mes con elementos.
   */
  vistaMovil?: "puntos" | "agenda"
  /** Avisa el día elegido; en escritorio además se resalta en la grilla. */
  onDiaSeleccionado?: (fecha: string) => void
  /** Si está activo (por defecto cuando no hay panel lateral `onDiaSeleccionado`), al presionar un día se abre una ventana modal con todos los servicios del día. */
  modalDia?: boolean
}

const ETIQUETAS_TAREA = { singular: "tarea", plural: "tareas", vacio: "Sin tareas este día" }

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
  etiquetas = ETIQUETAS_TAREA,
  vistaMovil = "puntos",
  onDiaSeleccionado,
  modalDia = !onDiaSeleccionado,
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
  const [seleccionado, setSeleccionadoInterno] = useState<string>(iso(new Date()))
  const [diaModal, setDiaModal] = useState<string | null>(null)
  const setSeleccionado = (fecha: string) => {
    setSeleccionadoInterno(fecha)
    onDiaSeleccionado?.(fecha)
  }
  const abrirDia = (fecha: string) => {
    setSeleccionado(fecha)
    if (modalDia) setDiaModal(fecha)
  }
  const delDia = porDia.get(seleccionado) ?? []
  const listaModal = diaModal ? (porDia.get(diaModal) ?? []) : []
  const agenda = vistaMovil === "agenda"
  const diasDelMes = useMemo(
    () =>
      [...porDia.entries()]
        .filter(([fecha]) => isSameMonth(parseISO(fecha), mes))
        .sort(([a], [b]) => a.localeCompare(b)),
    [porDia, mes],
  )

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
          agenda && "max-md:hidden",
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
                onClick={() => abrirDia(k)}
                className={cn(
                  "group relative flex min-h-14 flex-col gap-1 border-b p-1 md:min-h-32 md:p-1.5",
                  modalDia && "cursor-pointer hover:bg-muted/20",
                  i % 7 !== 6 && "border-r",
                  fuera && "bg-muted/30",
                  k === seleccionado && "max-md:bg-accent",
                  k === seleccionado && onDiaSeleccionado && "md:bg-accent/60",
                )}
              >
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      abrirDia(k)
                    }}
                    aria-label={`${fmtDiaLargo(d)}: ${lista.length} ${lista.length === 1 ? etiquetas.singular : etiquetas.plural}`}
                    aria-pressed={onDiaSeleccionado ? k === seleccionado : undefined}
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full text-xs tabular-nums max-md:after:absolute max-md:after:inset-0 pointer-coarse:size-8",
                      fuera && "text-muted-foreground",
                      hoy && "bg-primary font-semibold text-primary-foreground",
                    )}
                  >
                    {d.getDate()}
                  </button>
                  {onNuevo && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onNuevo(k)
                      }}
                      aria-label={`Nueva tarea el ${fmtDiaLargo(d)}`}
                      className="hidden size-6 items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 md:flex pointer-coarse:size-8 pointer-coarse:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Celular: puntos */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    abrirDia(k)
                  }}
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

                {/* Escritorio: tarjetas (máximo maxPorDia=3 en vista previa) */}
                <div className="hidden min-w-0 flex-col gap-1 md:flex">
                  {visibles.map((it) => (
                    <div
                      key={claveDe(it)}
                      className="min-w-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {renderItem(it)}
                    </div>
                  ))}
                  {resto > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDiaModal(k)
                      }}
                      className="rounded px-1 text-left text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:py-1.5"
                    >
                      +{resto} más
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Ventana modal con todos los servicios planificados para el día presionado */}
      <Dialog open={!!diaModal} onOpenChange={(abierto) => !abierto && setDiaModal(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="capitalize">
              Servicios planificados — {diaModal ? fmtDiaLargo(diaModal) : ""}
            </DialogTitle>
            <DialogDescription>
              {listaModal.length}{" "}
              {listaModal.length === 1 ? etiquetas.singular : etiquetas.plural} para este día
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {listaModal.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                {etiquetas.vacio}
              </p>
            ) : (
              listaModal.map((it) => (
                <div key={claveDe(it)} onClick={() => setDiaModal(null)}>
                  {renderItem(it)}
                </div>
              ))
            )}
          </div>
          {onNuevo && diaModal && (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const f = diaModal
                  setDiaModal(null)
                  onNuevo(f)
                }}
              >
                <Plus />
                Nueva {etiquetas.singular}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Celular, modo agenda: días del mes con elementos */}
      {agenda && (
        <section className="space-y-4 md:hidden" aria-label="Agenda del mes">
          {diasDelMes.length === 0 ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              Sin {etiquetas.plural} este mes
            </p>
          ) : (
            diasDelMes.map(([fecha, lista]) => (
              <div key={fecha} className="space-y-2">
                <h3
                  className={cn(
                    "text-sm font-medium capitalize",
                    isToday(parseISO(fecha)) && "text-primary",
                  )}
                >
                  {fmtDiaLargo(fecha)}
                </h3>
                {lista.map((it) => (
                  <div key={claveDe(it)}>{renderItem(it)}</div>
                ))}
              </div>
            ))
          )}
        </section>
      )}

      {/* Celular: lista del día elegido */}
      <section
        className={cn("space-y-2 md:hidden", agenda && "hidden")}
        aria-label="Día seleccionado"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium capitalize">{fmtDiaLargo(seleccionado)}</h3>
          {onNuevo && (
            <Button
              size="sm"
              variant="outline"
              className="pointer-coarse:h-11"
              onClick={() => onNuevo(seleccionado)}
            >
              <Plus />
              Nueva
            </Button>
          )}
        </div>
        {delDia.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            {etiquetas.vacio}
          </p>
        ) : (
          delDia.map((it) => <div key={claveDe(it)}>{renderItem(it)}</div>)
        )}
      </section>
    </div>
  )
}
