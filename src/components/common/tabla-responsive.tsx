import type { ReactNode } from "react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

/**
 * Patrón de tabla a tarjetas: tabla desde `desde` hacia arriba y una tarjeta por fila en pantallas
 * más chicas (celular y tablet vertical, según `desde`). Una sola fuente de columnas alimenta las
 * dos vistas, así no se duplica el markup en cada pantalla.
 *
 * Convención: las pantallas con tablas nuevas o migradas usan este componente; si la tarjeta
 * necesita un diseño propio (como `VisitaTarjeta` en el portal), se pasa `tarjeta`.
 */
export type ColumnaTabla<T> = {
  id: string
  encabezado: ReactNode
  celda: (fila: T) => ReactNode
  /** Clase de la celda y del encabezado en la tabla (p. ej. "text-right tabular-nums"). */
  className?: string
  /**
   * En la tarjeta: "titulo" va arriba sin etiqueta, "campo" (por defecto) muestra etiqueta y
   * valor, "oculta" no aparece.
   */
  enTarjeta?: "titulo" | "campo" | "oculta"
  /** Etiqueta del campo en la tarjeta cuando el encabezado no es texto. */
  etiqueta?: string
}

const VISIBLE_TABLA = { md: "hidden md:block", lg: "hidden lg:block" } as const
const VISIBLE_TARJETAS = { md: "md:hidden", lg: "lg:hidden" } as const

export type CampoTarjeta = { etiqueta: string; valor: ReactNode }

/** Tarjeta de una fila: título, pares etiqueta/valor y una franja de acciones táctiles. */
export function FilaTarjeta({
  titulo,
  campos,
  acciones,
  className,
}: {
  titulo?: ReactNode
  campos: CampoTarjeta[]
  acciones?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-3 rounded-lg border bg-card p-3 text-sm", className)}>
      {titulo && <div className="min-w-0 space-y-0.5 font-medium break-words">{titulo}</div>}
      {campos.length > 0 && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {campos.map((c) => (
            <div key={c.etiqueta} className="col-span-2 grid grid-cols-subgrid items-baseline">
              <dt className="text-muted-foreground">{c.etiqueta}</dt>
              <dd className="min-w-0 break-words tabular-nums">{c.valor}</dd>
            </div>
          ))}
        </dl>
      )}
      {acciones && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">{acciones}</div>
      )}
    </div>
  )
}

function etiquetaDe<T>(c: ColumnaTabla<T>) {
  return c.etiqueta ?? (typeof c.encabezado === "string" ? c.encabezado : c.id)
}

export function TablaResponsive<T>({
  filas,
  columnas,
  clave,
  acciones,
  tarjeta,
  desde = "md",
  descripcion,
  onFila,
  className,
}: {
  filas: T[]
  columnas: ColumnaTabla<T>[]
  clave: (fila: T) => string
  /** Botones de la fila: última columna de la tabla y franja inferior de la tarjeta. */
  acciones?: (fila: T) => ReactNode
  /** Reemplaza la tarjeta generada por una propia. */
  tarjeta?: (fila: T) => ReactNode
  /** Ancho a partir del cual se muestra la tabla. */
  desde?: "md" | "lg"
  /** Nombre accesible de la tabla. */
  descripcion?: string
  /** Hace clic-ables las filas de la tabla (la tarjeta propia decide cómo navegar). */
  onFila?: (fila: T) => void
  className?: string
}) {
  const titulos = columnas.filter((c) => c.enTarjeta === "titulo")
  const campos = columnas.filter((c) => (c.enTarjeta ?? "campo") === "campo")

  return (
    <div className={className}>
      <div className={cn("overflow-x-auto rounded-lg border", VISIBLE_TABLA[desde])}>
        <Table aria-label={descripcion}>
          <TableHeader className="bg-muted/50">
            <TableRow>
              {columnas.map((c) => (
                <TableHead key={c.id} className={c.className}>
                  {c.encabezado}
                </TableHead>
              ))}
              {acciones && (
                <TableHead>
                  <span className="sr-only">Acciones</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filas.map((fila) => (
              <TableRow
                key={clave(fila)}
                className={onFila ? "cursor-pointer" : undefined}
                onClick={onFila ? () => onFila(fila) : undefined}
              >
                {columnas.map((c) => (
                  <TableCell key={c.id} className={c.className}>
                    {c.celda(fila)}
                  </TableCell>
                ))}
                {acciones && (
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">{acciones(fila)}</div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className={cn("space-y-3", VISIBLE_TARJETAS[desde])} aria-label={descripcion}>
        {filas.map((fila) => (
          <li key={clave(fila)}>
            {tarjeta ? (
              tarjeta(fila)
            ) : (
              <FilaTarjeta
                titulo={
                  titulos.length
                    ? titulos.map((c) => <div key={c.id}>{c.celda(fila)}</div>)
                    : undefined
                }
                campos={campos.map((c) => ({ etiqueta: etiquetaDe(c), valor: c.celda(fila) }))}
                acciones={acciones?.(fila)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
