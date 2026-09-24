"use client"

import { ChevronRight } from "lucide-react"

import type { ArbolYacimiento, NivelEstructura } from "@/lib/domain/types"
import { cn } from "@/lib/utils"

import { claveNodo, NIVEL, type Seleccion } from "./arbol-utils"

interface NodoVista {
  nivel: NivelEstructura
  id: string
  label: string
  detalle?: string
  hijos: NodoVista[]
}

function aVista(arbol: ArbolYacimiento[]): NodoVista[] {
  return arbol.map((y) => ({
    nivel: "yacimiento",
    id: y.id,
    label: y.nombre,
    hijos: y.plantas.map((p) => ({
      nivel: "planta",
      id: p.id,
      label: p.nombre,
      hijos: p.equipos.map((e) => ({
        nivel: "equipo",
        id: e.id,
        label: e.nombre,
        detalle: String(e.valvulas.length),
        hijos: e.valvulas.map((v) => ({
          nivel: "valvula",
          id: v.id,
          label: v.tag,
          hijos: [],
        })),
      })),
    })),
  }))
}

export function ArbolNav({
  arbol,
  seleccion,
  expandidos,
  forzarExpandido,
  onSeleccionar,
  onToggle,
}: {
  arbol: ArbolYacimiento[]
  seleccion: Seleccion | null
  expandidos: Set<string>
  /** Con búsqueda activa se muestra todo expandido. */
  forzarExpandido: boolean
  onSeleccionar: (s: Seleccion) => void
  onToggle: (clave: string) => void
}) {
  const seleccionada = seleccion ? claveNodo(seleccion) : null

  function render(nodos: NodoVista[], profundidad: number) {
    return (
      <ul role={profundidad === 0 ? "tree" : "group"} className="space-y-0.5">
        {nodos.map((n) => {
          const clave = claveNodo(n)
          const abierto = forzarExpandido || expandidos.has(clave)
          const tieneHijos = n.hijos.length > 0
          const Icono = NIVEL[n.nivel].icono
          const activo = clave === seleccionada
          return (
            <li
              key={clave}
              role="treeitem"
              aria-expanded={tieneHijos ? abierto : undefined}
              aria-selected={activo}
            >
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md pr-2 text-sm",
                  activo ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
                style={{ paddingLeft: `${profundidad * 0.875 + 0.25}rem` }}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => tieneHijos && onToggle(clave)}
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded",
                    !tieneHijos && "invisible",
                  )}
                  aria-label={abierto ? "Contraer" : "Expandir"}
                >
                  <ChevronRight
                    className={cn("size-3.5 transition-transform", abierto && "rotate-90")}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onSeleccionar({ nivel: n.nivel, id: n.id })}
                  className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                >
                  <Icono
                    className={cn(
                      "size-4 shrink-0",
                      activo ? "text-primary-foreground" : "text-muted-foreground",
                    )}
                  />
                  <span className="truncate">{n.label}</span>
                  {n.detalle && (
                    <span
                      className={cn(
                        "ml-auto text-xs tabular-nums",
                        activo ? "text-primary-foreground/80" : "text-muted-foreground",
                      )}
                    >
                      {n.detalle}
                    </span>
                  )}
                </button>
              </div>
              {tieneHijos && abierto && render(n.hijos, profundidad + 1)}
            </li>
          )
        })}
      </ul>
    )
  }

  return render(aVista(arbol), 0)
}
