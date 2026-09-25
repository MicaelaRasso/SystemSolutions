"use client"

import { Checkbox } from "@/components/ui/checkbox"
import type { AccesoCliente, ArbolYacimiento, NivelAcceso } from "@/lib/domain/types"
import { cn } from "@/lib/utils"

import { NIVEL } from "@/components/estructura/arbol-utils"

export type ClaveAcceso = `${NivelAcceso}:${string}`

export const claveAcceso = (a: Pick<AccesoCliente, "nivel" | "refId">): ClaveAcceso =>
  `${a.nivel}:${a.refId}`

export function accesosDesdeClaves(claves: Set<ClaveAcceso>): Omit<AccesoCliente, "usuarioId">[] {
  return [...claves].map((c) => {
    const [nivel, refId] = c.split(":") as [NivelAcceso, string]
    return { nivel, refId }
  })
}

interface Fila {
  clave: ClaveAcceso
  nivel: NivelAcceso
  label: string
  profundidad: number
  ancestros: ClaveAcceso[]
  descendientes: ClaveAcceso[]
}

function filas(arbol: ArbolYacimiento[]): Fila[] {
  const out: Fila[] = []
  for (const y of arbol) {
    const cy: ClaveAcceso = `yacimiento:${y.id}`
    const desY: ClaveAcceso[] = []
    const idxY =
      out.push({
        clave: cy,
        nivel: "yacimiento",
        label: y.nombre,
        profundidad: 0,
        ancestros: [],
        descendientes: desY,
      }) - 1
    for (const p of y.plantas) {
      const cp: ClaveAcceso = `planta:${p.id}`
      const desP: ClaveAcceso[] = []
      desY.push(cp)
      out.push({
        clave: cp,
        nivel: "planta",
        label: p.nombre,
        profundidad: 1,
        ancestros: [cy],
        descendientes: desP,
      })
      for (const e of p.equipos) {
        const ce: ClaveAcceso = `equipo:${e.id}`
        desY.push(ce)
        desP.push(ce)
        out.push({
          clave: ce,
          nivel: "equipo",
          label: e.nombre,
          profundidad: 2,
          ancestros: [cy, cp],
          descendientes: [],
        })
      }
    }
    out[idxY].descendientes = desY
  }
  return out
}

/**
 * Selección de accesos por nivel (RN-09). Marcar un nivel incluye todo lo que tiene debajo,
 * por eso sus hijos se muestran marcados y deshabilitados.
 */
export function AccesosSelector({
  arbol,
  value,
  onChange,
}: {
  arbol: ArbolYacimiento[]
  value: Set<ClaveAcceso>
  onChange: (v: Set<ClaveAcceso>) => void
}) {
  const lista = filas(arbol)

  function toggle(f: Fila, marcado: boolean) {
    const next = new Set(value)
    if (marcado) {
      next.add(f.clave)
      // Al otorgar un nivel, los accesos puntuales de abajo pasan a ser redundantes.
      f.descendientes.forEach((d) => next.delete(d))
    } else {
      next.delete(f.clave)
    }
    onChange(next)
  }

  if (lista.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
        El cliente no tiene estructura cargada. Cargá sus yacimientos para poder asignar accesos.
      </p>
    )
  }

  return (
    <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border p-2">
      {lista.map((f) => {
        const heredado = f.ancestros.some((a) => value.has(a))
        const marcado = heredado || value.has(f.clave)
        const Icono = NIVEL[f.nivel].icono
        const id = `acceso-${f.clave}`
        return (
          <li
            key={f.clave}
            className={cn("flex items-center gap-2 rounded-md py-1 pr-2 hover:bg-muted/60")}
            style={{ paddingLeft: `${f.profundidad * 1.25 + 0.5}rem` }}
          >
            <Checkbox
              id={id}
              checked={marcado}
              disabled={heredado}
              onCheckedChange={(v) => toggle(f, v === true)}
            />
            <label
              htmlFor={id}
              className={cn(
                "flex flex-1 cursor-pointer items-center gap-2 text-sm",
                heredado && "cursor-default text-muted-foreground",
              )}
            >
              <Icono className="size-4 text-muted-foreground" />
              {f.label}
              {heredado && <span className="ml-auto text-xs">incluido</span>}
            </label>
          </li>
        )
      })}
    </ul>
  )
}
