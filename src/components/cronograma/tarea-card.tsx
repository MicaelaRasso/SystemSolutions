"use client"

import { ArrowRightLeft, Eye, GripVertical, MoreHorizontal, Pencil } from "lucide-react"
import Link from "next/link"

import { COLOR_SIN_TALLER } from "@/components/tareas/badges"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ESTADO_TAREA_LABEL } from "@/lib/domain/rules"
import type { TallerConCuenta, TareaResumen } from "@/lib/services"
import { cn } from "@/lib/utils"

export const SIN_TALLER = "sin_asignar"

/** Solo se reprograman las tareas que todavía no empezaron. */
export const esMovible = (t: TareaResumen) => t.estado === "pendiente" || t.estado === "asignada"

/**
 * Tarjeta de tarea en el cronograma. Se arrastra a otra celda para reasignar taller y/o día;
 * el menú ofrece lo mismo sin arrastrar (teclado, pantallas táctiles).
 */
export function TareaCard({
  tarea,
  talleres,
  onVer,
  onAsignar,
  onDragStart,
  onDragEnd,
}: {
  tarea: TareaResumen
  talleres: TallerConCuenta[]
  onVer: () => void
  onAsignar: (tallerId: string | undefined) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const movible = esMovible(tarea)
  const color = tarea.tallerColor ?? COLOR_SIN_TALLER

  return (
    <div
      draggable={movible}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", tarea.id)
        e.dataTransfer.effectAllowed = "move"
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      className={cn(
        "group flex items-start gap-1 rounded-md border bg-card py-1 pr-0.5 pl-1 text-xs shadow-xs",
        movible && "cursor-grab active:cursor-grabbing",
        tarea.estado === "cancelada" && "line-through opacity-50",
        tarea.estado === "completada" && "opacity-70",
      )}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      {movible && (
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
      )}
      <button type="button" onClick={onVer} className="min-w-0 flex-1 text-left leading-tight">
        <span className="block truncate font-medium">
          {tarea.horario && <span className="tabular-nums">{tarea.horario} </span>}
          {tarea.empresaNombre}
        </span>
        <span className="block truncate text-muted-foreground">
          {tarea.plantaNombre} · {tarea.equipoNombre}
        </span>
        {!movible && (
          <span className="block text-[10px] text-muted-foreground">
            {ESTADO_TAREA_LABEL[tarea.estado]}
          </span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`Acciones de la solicitud ${tarea.nroSolicitud}`}
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={onVer}>
            <Eye />
            Ver detalle
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href={`/admin/tareas/${tarea.id}`}>
              <Pencil />
              Editar
            </Link>
          </DropdownMenuItem>
          {movible && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRightLeft />
                  Asignar a
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={tarea.tallerId ?? SIN_TALLER}
                    onValueChange={(v) => onAsignar(v === SIN_TALLER ? undefined : v)}
                  >
                    {talleres.map((t) => (
                      <DropdownMenuRadioItem key={t.id} value={t.id}>
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: t.color }}
                        />
                        {t.nombre}
                      </DropdownMenuRadioItem>
                    ))}
                    <DropdownMenuRadioItem value={SIN_TALLER}>Sin asignar</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
