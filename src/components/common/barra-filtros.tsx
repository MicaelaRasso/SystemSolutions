"use client"

import { ListFilter, X } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * Barra de filtros responsive. En escritorio y tablet los campos van en una grilla; en celular se
 * pliegan detrás de un botón "Filtros" (con el conteo de filtros activos) para no empujar el
 * contenido fuera de la pantalla. Los campos se declaran con `CampoFiltro`.
 */
export function BarraFiltros({
  children,
  activos = 0,
  onLimpiar,
  columnas = "sm:grid-cols-2 lg:grid-cols-4",
  className,
}: {
  children: React.ReactNode
  /** Cantidad de filtros aplicados: se muestra en el botón del celular. */
  activos?: number
  onLimpiar?: () => void
  /** Clases de columnas de la grilla desde `sm`. */
  columnas?: string
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)

  return (
    <div className={cn("space-y-3", className)} role="group" aria-label="Filtros">
      <div className="flex items-center gap-2 md:hidden">
        <Button
          type="button"
          variant="outline"
          className="flex-1 justify-between"
          aria-expanded={abierto}
          aria-controls="barra-filtros-campos"
          onClick={() => setAbierto((a) => !a)}
        >
          <span className="flex items-center gap-2">
            <ListFilter />
            Filtros
          </span>
          {activos > 0 && (
            <span className="rounded-full bg-primary px-2 text-xs text-primary-foreground tabular-nums">
              {activos}
            </span>
          )}
        </Button>
        {onLimpiar && activos > 0 && (
          <Button type="button" variant="ghost" onClick={onLimpiar}>
            <X />
            Limpiar
          </Button>
        )}
      </div>
      <div
        id="barra-filtros-campos"
        className={cn("grid gap-3 md:grid", abierto ? "grid" : "hidden", columnas)}
      >
        {children}
      </div>
    </div>
  )
}

/** Un campo de la barra de filtros: etiqueta más control, con ancho mínimo cero para no desbordar. */
export function CampoFiltro({
  etiqueta,
  htmlFor,
  className,
  children,
}: {
  etiqueta: string
  htmlFor?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={htmlFor}>{etiqueta}</Label>
      {children}
    </div>
  )
}
