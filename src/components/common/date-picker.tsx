"use client"

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { hoyIso } from "@/lib/fechas"
import { cn } from "@/lib/utils"

import {
  etiquetaDia,
  fechaInicialFoco,
  formatoVisible,
  fueraDeRango,
  grillaMes,
  inicioDeMes,
  moverFoco,
  sumarMeses,
  tituloMes,
} from "./date-picker-utils"

const DIAS_SEMANA = [
  ["LU", "lunes"],
  ["MA", "martes"],
  ["MI", "miércoles"],
  ["JU", "jueves"],
  ["VI", "viernes"],
  ["SA", "sábado"],
  ["DO", "domingo"],
] as const

export interface CalendarioPanelProps {
  /** Fecha elegida (`yyyy-MM-dd` o vacío). */
  valor: string
  /** Día con el foco de teclado; define el mes visible. */
  foco: string
  hoy: string
  min?: string
  max?: string
  /** Muestra «Borrar» para dejar el campo vacío. */
  opcional?: boolean
  onFoco: (fecha: string, enfocar: boolean) => void
  onElegir: (fecha: string) => void
  onBorrar: () => void
  grillaRef?: React.Ref<HTMLTableElement>
}

/** Mes con navegación, grilla de días y acciones. Sin estado propio: lo maneja `DatePicker`. */
export function CalendarioPanel({
  valor,
  foco,
  hoy,
  min,
  max,
  opcional,
  onFoco,
  onElegir,
  onBorrar,
  grillaRef,
}: CalendarioPanelProps) {
  const tituloId = useId()
  const dias = grillaMes(foco)
  const semanas = Array.from({ length: 6 }, (_, i) => dias.slice(i * 7, i * 7 + 7))
  const inicio = inicioDeMes(foco)
  const sinAnterior = !!min && inicio <= min
  const sinSiguiente = !!max && inicioDeMes(sumarMeses(inicio, 1)) > max

  function onKeyDown(e: React.KeyboardEvent<HTMLTableElement>) {
    const destino = moverFoco(foco, e.key, e.shiftKey)
    if (!destino) return
    e.preventDefault()
    onFoco(destino, true)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 pointer-coarse:size-11"
          aria-label="Mes anterior"
          disabled={sinAnterior}
          onClick={() => onFoco(sumarMeses(foco, -1), false)}
        >
          <ChevronLeft />
        </Button>
        <h2
          id={tituloId}
          aria-live="polite"
          className="text-sm font-semibold capitalize tabular-nums"
        >
          {tituloMes(foco)}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 pointer-coarse:size-11"
          aria-label="Mes siguiente"
          disabled={sinSiguiente}
          onClick={() => onFoco(sumarMeses(foco, 1), false)}
        >
          <ChevronRight />
        </Button>
      </div>

      <table
        ref={grillaRef}
        role="grid"
        aria-labelledby={tituloId}
        onKeyDown={onKeyDown}
        className="w-full table-fixed border-collapse"
      >
        <thead>
          <tr>
            {DIAS_SEMANA.map(([corto, largo]) => (
              <th
                key={corto}
                scope="col"
                abbr={largo}
                className="pb-1 text-[0.7rem] font-medium tracking-wide text-muted-foreground"
              >
                {corto}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((semana) => (
            <tr key={semana[0].iso}>
              {semana.map((d) => {
                const elegido = d.iso === valor
                const esHoy = d.iso === hoy
                const bloqueado = fueraDeRango(d.iso, min, max)
                return (
                  <td key={d.iso} role="gridcell" aria-selected={elegido} className="p-px">
                    <button
                      type="button"
                      data-fecha={d.iso}
                      tabIndex={d.iso === foco ? 0 : -1}
                      aria-label={`${etiquetaDia(d.iso)}${esHoy ? ", hoy" : ""}`}
                      aria-current={esHoy ? "date" : undefined}
                      aria-disabled={bloqueado || undefined}
                      onClick={() => {
                        if (bloqueado) return
                        onElegir(d.iso)
                      }}
                      className={cn(
                        "relative flex h-10 w-full items-center justify-center rounded-md text-sm tabular-nums transition-colors outline-none select-none pointer-coarse:h-11",
                        "focus-visible:ring-3 focus-visible:ring-ring/50",
                        !bloqueado && !elegido && "hover:bg-muted active:bg-muted/70",
                        d.fueraDeMes && "text-muted-foreground",
                        esHoy && !elegido && "font-semibold text-primary",
                        elegido &&
                          "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
                        bloqueado && !elegido && "cursor-not-allowed text-muted-foreground/45",
                      )}
                    >
                      {d.dia}
                      {esHoy && (
                        <span
                          aria-hidden
                          className={cn(
                            "absolute bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full",
                            elegido ? "bg-primary-foreground" : "bg-primary",
                          )}
                        />
                      )}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between border-t pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 px-3 pointer-coarse:h-11"
          disabled={fueraDeRango(hoy, min, max)}
          onClick={() => onElegir(hoy)}
        >
          Hoy
        </Button>
        {opcional && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-muted-foreground pointer-coarse:h-11"
            disabled={!valor}
            onClick={onBorrar}
          >
            Borrar
          </Button>
        )}
      </div>
    </div>
  )
}

/** Enfoca el único día de la grilla que está en el orden de tabulación. */
const enfocarBotonDelDia = (grilla: HTMLTableElement | null) =>
  grilla?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()

export interface DatePickerProps {
  id?: string
  name?: string
  /** `yyyy-MM-dd` o vacío: el mismo formato que usaba `<input type="date">`. */
  value: string
  onChange: (valor: string) => void
  onBlur?: () => void
  min?: string
  max?: string
  opcional?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
  "aria-required"?: boolean
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * Selector de fecha propio, en reemplazo del calendario nativo del navegador. Se usa con
 * `Controller` de react-hook-form (valor controlado `yyyy-MM-dd`).
 */
export function DatePicker({
  id,
  name,
  value,
  onChange,
  onBlur,
  min,
  max,
  opcional,
  placeholder = "Elegir fecha",
  disabled,
  className,
  ref,
  ...aria
}: DatePickerProps) {
  const [abierto, setAbierto] = useState(false)
  const [foco, setFoco] = useState(() => fechaInicialFoco(value, hoyIso(), min, max))
  const enfocarDia = useRef(false)
  const grillaRef = useRef<HTMLTableElement>(null)
  const panelId = useId()
  const texto = formatoVisible(value)

  // Tras navegar con el teclado, el foco sigue al día (también al cambiar de mes).
  useEffect(() => {
    if (!enfocarDia.current) return
    enfocarDia.current = false
    enfocarBotonDelDia(grillaRef.current)
  }, [foco])

  function cambiarAbierto(abrir: boolean) {
    if (abrir) setFoco(fechaInicialFoco(value, hoyIso(), min, max))
    setAbierto(abrir)
  }

  function elegir(fecha: string) {
    onChange(fecha)
    setAbierto(false)
  }

  return (
    <Popover open={abierto} onOpenChange={cambiarAbierto}>
      <PopoverTrigger asChild>
        <button
          ref={ref}
          id={id}
          type="button"
          // Como los SelectTrigger: botón que abre un popup y puede marcarse inválido.
          role="combobox"
          aria-expanded={abierto}
          aria-controls={abierto ? panelId : undefined}
          disabled={disabled}
          onBlur={onBlur}
          aria-invalid={aria["aria-invalid"]}
          aria-describedby={aria["aria-describedby"]}
          aria-required={aria["aria-required"]}
          data-placeholder={texto ? undefined : ""}
          className={cn(
            "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent pr-2 pl-2.5 text-left text-base whitespace-nowrap transition-colors outline-none select-none md:text-sm pointer-coarse:h-11",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:cursor-not-allowed disabled:opacity-50 aria-expanded:border-ring",
            "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
            "data-placeholder:text-muted-foreground dark:bg-input/30 dark:hover:bg-input/50",
            "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
            className,
          )}
        >
          <span className="truncate tabular-nums">{texto || placeholder}</span>
          <CalendarDays aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {name && <input type="hidden" name={name} value={value} />}
      <PopoverContent
        id={panelId}
        align="start"
        collisionPadding={12}
        aria-label="Elegir fecha"
        className="w-[min(18.5rem,calc(100vw-1.5rem))] p-3 pointer-coarse:w-[min(21.5rem,calc(100vw-1.5rem))]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          enfocarBotonDelDia(grillaRef.current)
        }}
      >
        <CalendarioPanel
          valor={value}
          foco={foco}
          hoy={hoyIso()}
          min={min}
          max={max}
          opcional={opcional}
          grillaRef={grillaRef}
          onFoco={(fecha, enfocar) => {
            setFoco(fecha)
            enfocarDia.current = enfocar
          }}
          onElegir={elegir}
          onBorrar={() => elegir("")}
        />
      </PopoverContent>
    </Popover>
  )
}
