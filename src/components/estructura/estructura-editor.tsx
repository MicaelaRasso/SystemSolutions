"use client"

import { MapPinned, Plus, Search } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useRef, useState } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { ID } from "@/lib/domain/types"
import { plural } from "@/lib/format"
import { useArbol } from "@/lib/hooks/queries"

import { ArbolNav } from "./arbol-nav"
import {
  ancestros,
  claveNodo,
  contar,
  filtrarArbol,
  parsearSeleccion,
  ubicar,
  type Seleccion,
} from "./arbol-utils"
import { NodoDetalle } from "./nodo-detalle"
import { YacimientoDialog } from "./dialogs"

/** Gestión de la jerarquía yacimiento → planta → equipo → válvula de un cliente (RF-08). */
export function EstructuraEditor({ empresaId }: { empresaId: ID }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: arbol, isPending, isError, error, refetch } = useArbol(empresaId)

  const detalleRef = useRef<HTMLElement>(null)
  const [busqueda, setBusqueda] = useState("")
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  // La selección vive en la URL (?sel=valvula:ID) para poder compartir el enlace a una ficha.
  const selParam = searchParams.get("sel")
  const seleccion = useMemo(() => parsearSeleccion(selParam), [selParam])
  const ubicacion = useMemo(
    () => (arbol && seleccion ? ubicar(arbol, seleccion) : null),
    [arbol, seleccion],
  )

  // Camino a expandir cuando el nodo seleccionado esté en el árbol: al abrir un enlace
  // o al crear un nodo (aparece recién cuando se vuelve a leer el árbol).
  const [expandirPendiente, setExpandirPendiente] = useState<string | null>(selParam)
  if (expandirPendiente && ubicacion && seleccion && claveNodo(seleccion) === expandirPendiente) {
    setExpandirPendiente(null)
    setExpandidos((prev) => new Set([...prev, ...ancestros(ubicacion), expandirPendiente]))
  }

  const seleccionar = useCallback(
    (s: Seleccion | null) => {
      const params = new URLSearchParams(searchParams)
      if (s) params.set("sel", claveNodo(s))
      else params.delete("sel")
      router.replace(`${pathname}?${params}`, { scroll: false })
      setExpandirPendiente(s ? claveNodo(s) : null)
      // En pantallas angostas el detalle queda debajo del árbol: se lo lleva a la vista.
      if (s && window.matchMedia("(max-width: 1023px)").matches) {
        requestAnimationFrame(() =>
          detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
        )
      }
    },
    [pathname, router, searchParams],
  )

  const toggle = (clave: string) =>
    setExpandidos((prev) => {
      const next = new Set(prev)
      if (next.has(clave)) next.delete(clave)
      else next.add(clave)
      return next
    })

  const filtrado = useMemo(() => (arbol ? filtrarArbol(arbol, busqueda) : []), [arbol, busqueda])

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />

  if (isPending) {
    return (
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const totales = contar(arbol)

  const nuevoYacimiento = (
    <YacimientoDialog
      empresaId={empresaId}
      onSaved={(id) => seleccionar({ nivel: "yacimiento", id })}
      trigger={
        <Button size="sm">
          <Plus />
          Yacimiento
        </Button>
      }
    />
  )

  if (arbol.length === 0) {
    return (
      <EmptyState
        icono={MapPinned}
        titulo="El cliente no tiene yacimientos cargados"
        descripcion="Empezá por el yacimiento y después agregá sus plantas, equipos y válvulas."
        accion={nuevoYacimiento}
      />
    )
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <section
        aria-label="Árbol de estructura"
        className="flex flex-col gap-3 rounded-xl border bg-card p-3 lg:sticky lg:top-16 lg:max-h-[calc(100svh-5rem)]"
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-xs text-muted-foreground">
            {plural(totales.yacimientos, "yacimiento")} · {plural(totales.valvulas, "válvula")}
          </p>
          {nuevoYacimiento}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar nombre, TAG o serie"
            className="pl-8"
            aria-label="Buscar en la estructura"
          />
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {filtrado.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Sin coincidencias</p>
          ) : (
            <ArbolNav
              arbol={filtrado}
              seleccion={seleccion}
              expandidos={expandidos}
              forzarExpandido={busqueda.trim() !== ""}
              onSeleccionar={seleccionar}
              onToggle={toggle}
            />
          )}
        </div>
      </section>

      <section ref={detalleRef} aria-label="Detalle" className="min-w-0 scroll-mt-16">
        {ubicacion && seleccion ? (
          <NodoDetalle
            empresaId={empresaId}
            nivel={seleccion.nivel}
            ubicacion={ubicacion}
            onSeleccionar={seleccionar}
          />
        ) : (
          <EmptyState
            titulo="Seleccioná un elemento del árbol"
            descripcion="Vas a ver su detalle, editarlo y agregarle elementos. Las válvulas muestran su ficha y el historial de certificados."
          />
        )}
      </section>
    </div>
  )
}
