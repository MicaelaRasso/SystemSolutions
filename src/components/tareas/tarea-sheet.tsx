"use client"

import { Clock, FileText, MapPin, Paperclip, Pencil, Phone, User } from "lucide-react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { fmtDiaLargo } from "@/lib/fechas"
import type { TareaResumen } from "@/lib/services"

import { EstadoTareaBadge, TallerChip } from "./badges"

function Dato({ icono: Icono, children }: { icono: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <Icono className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Detalle de una tarea desde la agenda o el cronograma (RF-12). */
export function TareaSheet({
  tarea,
  onOpenChange,
}: {
  tarea: TareaResumen | null
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={!!tarea} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        {tarea && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoTareaBadge estado={tarea.estado} />
                <Badge variant="outline">{tarea.tipo}</Badge>
              </div>
              <SheetTitle className="text-lg">Solicitud N° {tarea.nroSolicitud}</SheetTitle>
              <SheetDescription>{tarea.empresaNombre}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-4">
              <Dato icono={Clock}>
                <span className="inline-block first-letter:uppercase">
                  {fmtDiaLargo(tarea.fechaEjecucion)}
                </span>
                {tarea.horario && (
                  <span className="text-muted-foreground"> · {tarea.horario} h</span>
                )}
              </Dato>
              <Dato icono={MapPin}>
                <div className="font-medium">{tarea.plantaNombre}</div>
                <div className="text-muted-foreground">
                  {tarea.yacimientoNombre} · Equipo {tarea.equipoNombre}
                </div>
              </Dato>
              <Dato icono={User}>
                <TallerChip nombre={tarea.tallerNombre} color={tarea.tallerColor} />
              </Dato>
              <Dato icono={Phone}>
                {tarea.contacto} · {tarea.telefono}
              </Dato>
              <Dato icono={FileText}>
                <p className="whitespace-pre-line">{tarea.detalle}</p>
                {(tarea.ordenTrabajo || tarea.pdRto) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tarea.ordenTrabajo && `OT ${tarea.ordenTrabajo}`}
                    {tarea.ordenTrabajo && tarea.pdRto && " · "}
                    {tarea.pdRto && `PD/RTO ${tarea.pdRto}`}
                  </p>
                )}
              </Dato>
              {tarea.condiciones.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {tarea.condiciones.map((c) => (
                    <Badge key={c} variant="secondary" className="font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
              {tarea.adjuntos.length > 0 && (
                <Dato icono={Paperclip}>
                  {tarea.adjuntos.map((a) => (
                    <div key={a.id} className="truncate">
                      {a.nombre}
                    </div>
                  ))}
                </Dato>
              )}
            </div>
            <SheetFooter>
              <Button asChild>
                <Link href={`/admin/tareas/${tarea.id}`}>
                  <Pencil />
                  Editar tarea
                </Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
