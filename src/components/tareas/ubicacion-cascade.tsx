"use client"

import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ArbolYacimiento } from "@/lib/domain/types"
import { useArbol, useEmpresas } from "@/lib/hooks/queries"

export interface Ubicacion {
  empresaId: string
  yacimientoId: string
  plantaId: string
  equipoId: string
}

type Clave = keyof Ubicacion

const NIVELES: { clave: Clave; label: string; placeholder: string }[] = [
  { clave: "empresaId", label: "Cliente", placeholder: "Elegí el cliente" },
  { clave: "yacimientoId", label: "Yacimiento", placeholder: "Elegí el yacimiento" },
  { clave: "plantaId", label: "Planta / locación", placeholder: "Elegí la planta" },
  { clave: "equipoId", label: "Equipo / unidad", placeholder: "Elegí el equipo" },
]

function opcionesDe(clave: Clave, v: Ubicacion, arbol: ArbolYacimiento[] | undefined) {
  const yac = arbol?.find((y) => y.id === v.yacimientoId)
  const pla = yac?.plantas.find((p) => p.id === v.plantaId)
  switch (clave) {
    case "yacimientoId":
      return arbol?.map((y) => ({ id: y.id, label: y.nombre })) ?? []
    case "plantaId":
      return yac?.plantas.map((p) => ({ id: p.id, label: p.nombre })) ?? []
    case "equipoId":
      return (
        pla?.equipos.map((e) => ({
          id: e.id,
          label: e.descripcion ? `${e.nombre} · ${e.descripcion}` : e.nombre,
        })) ?? []
      )
    default:
      return []
  }
}

/**
 * Selección encadenada cliente → yacimiento → planta → equipo.
 * Al cambiar un nivel se limpian los de abajo; si el siguiente tiene una sola opción, se elige sola.
 */
export function UbicacionCascade({
  value,
  onChange,
  errores = {},
}: {
  value: Ubicacion
  onChange: (v: Ubicacion) => void
  errores?: Partial<Record<Clave, string | undefined>>
}) {
  const empresas = useEmpresas({ incluirInactivas: false })
  const arbol = useArbol(value.empresaId)

  function elegir(clave: Clave, id: string) {
    const i = NIVELES.findIndex((n) => n.clave === clave)
    const next = { ...value, [clave]: id }
    NIVELES.slice(i + 1).forEach((n) => (next[n.clave] = ""))
    // Autocompleta niveles con opción única (el árbol del cliente ya está cargado).
    if (clave !== "empresaId") {
      for (const n of NIVELES.slice(i + 1)) {
        const ops = opcionesDe(n.clave, next, arbol.data)
        if (ops.length !== 1) break
        next[n.clave] = ops[0].id
      }
    }
    onChange(next)
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {NIVELES.map(({ clave, label, placeholder }, i) => {
        const opciones =
          clave === "empresaId"
            ? (empresas.data?.map((e) => ({ id: e.id, label: e.razonSocial })) ?? [])
            : opcionesDe(clave, value, arbol.data)
        const padre = i > 0 ? value[NIVELES[i - 1].clave] : "x"
        const cargando =
          clave === "empresaId" ? empresas.isPending : !!value.empresaId && arbol.isPending
        const error = errores[clave]
        const id = `ubicacion-${clave}`
        return (
          <Field key={clave} data-invalid={!!error}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Select
              value={value[clave]}
              // Radix emite "" desde su <select> nativo oculto cuando el valor se fija por código
              // (autocompletado) antes de que existan las opciones: se ignora para no borrarlo.
              onValueChange={(v) => v && elegir(clave, v)}
              disabled={!padre || cargando}
            >
              <SelectTrigger id={id} className="w-full" aria-invalid={!!error}>
                <SelectValue placeholder={cargando ? "Cargando…" : placeholder} />
              </SelectTrigger>
              <SelectContent>
                {opciones.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
                {opciones.length === 0 && (
                  <div className="px-2 py-1.5 text-sm text-muted-foreground">Sin opciones</div>
                )}
              </SelectContent>
            </Select>
            <FieldError errors={error ? [{ message: error }] : undefined} />
          </Field>
        )
      })}
    </div>
  )
}
