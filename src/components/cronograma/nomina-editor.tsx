"use client"

import { AlertTriangle, UserPlus, Users } from "lucide-react"
import { useState } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { Persona } from "@/lib/domain/types"
import { fmtDiaLargo } from "@/lib/fechas"
import { cn } from "@/lib/utils"

/**
 * Nómina de un taller en una jornada (RN-15): quiénes integran el taller ese día.
 * Una persona no puede estar en dos talleres la misma jornada.
 */
export function NominaEditor({
  tallerNombre,
  fecha,
  seleccion: guardada,
  personas,
  ocupadas,
  conTareas,
  guardando,
  onChange,
}: {
  tallerNombre: string
  fecha: string
  seleccion: string[]
  personas: Persona[]
  /** personaId → nombre del otro taller en el que ya está ese día. */
  ocupadas: Map<string, string>
  conTareas: boolean
  guardando: boolean
  onChange: (personaIds: string[]) => Promise<unknown>
}) {
  // Actualización optimista: se muestra el cambio al instante hasta que llega la nómina guardada.
  const [local, setLocal] = useState<{ base: string; ids: string[] } | null>(null)
  const seleccion = local && local.base === guardada.join() ? local.ids : guardada

  function cambiar(ids: string[]) {
    setLocal({ base: guardada.join(), ids })
    onChange(ids).catch(() => setLocal(null))
  }

  const elegidas = personas.filter((p) => seleccion.includes(p.id))
  const disponibles = personas.filter((p) => p.activo || seleccion.includes(p.id))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted",
            elegidas.length === 0 && conTareas && "bg-amber-50 text-amber-900 hover:bg-amber-100",
          )}
          aria-label={`Nómina de ${tallerNombre} el ${fmtDiaLargo(fecha)}`}
        >
          {elegidas.length === 0 ? (
            conTareas ? (
              <>
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                Sin nómina
              </>
            ) : (
              <>
                <UserPlus className="mt-px size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">Asignar personal</span>
              </>
            )
          ) : (
            <>
              <Users className="mt-px size-3.5 shrink-0 text-muted-foreground" />
              <span className="leading-snug">
                {elegidas.map((p) => `${p.apellido} ${p.nombre[0]}.`).join(", ")}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <p className="text-sm font-medium">{tallerNombre}</p>
        <p className="mb-2 text-xs text-muted-foreground capitalize">{fmtDiaLargo(fecha)}</p>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {disponibles.map((p) => {
            const otro = ocupadas.get(p.id)
            const id = `nomina-${fecha}-${p.id}`
            const marcada = seleccion.includes(p.id)
            return (
              <li key={p.id}>
                <label
                  htmlFor={id}
                  className={cn(
                    "flex items-center gap-2 rounded px-1 py-1 text-sm",
                    otro && !marcada ? "text-muted-foreground" : "hover:bg-muted",
                  )}
                >
                  <Checkbox
                    id={id}
                    checked={marcada}
                    disabled={guardando || (!!otro && !marcada)}
                    onCheckedChange={(v) =>
                      cambiar(
                        v === true ? [...seleccion, p.id] : seleccion.filter((x) => x !== p.id),
                      )
                    }
                  />
                  <span className="flex-1">
                    {p.apellido}, {p.nombre}
                  </span>
                  {otro && !marcada && <span className="text-xs">en {otro}</span>}
                </label>
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Esta nómina queda en los certificados que emita el taller ese día.
        </p>
      </PopoverContent>
    </Popover>
  )
}
