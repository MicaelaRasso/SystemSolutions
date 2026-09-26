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
import type { Adjunto, EstadoTarea } from "@/lib/domain/types"
import type { OperationRead, OperationSummaryRead } from "@/lib/hooks/queries"
import type { TareaResumen } from "@/lib/services"

import { EstadoTareaBadge, TallerChip } from "./badges"

type OperationView = OperationSummaryRead | OperationRead
type OperationSummaryView = OperationSummaryRead

const ESTADO_OPERACION_A_TAREA: Record<OperationSummaryView["estado"], EstadoTarea> = {
  solicitada: "pendiente",
  programada: "asignada",
  aceptada: "asignada",
  en_curso: "en_curso",
  completada: "completada",
  cancelada: "cancelada",
}

function operationSummary(operation: OperationView): OperationSummaryView {
  return "operation" in operation ? operation.operation : operation
}

function stringField(record: Record<string, unknown> | undefined, ...names: string[]) {
  if (!record) return undefined
  const value = names.map((name) => record[name]).find((item) => typeof item === "string")
  return typeof value === "string" ? value : undefined
}

function recordField(record: Record<string, unknown> | undefined, name: string) {
  const value = record?.[name]
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringArrayField(record: Record<string, unknown> | undefined, name: string) {
  const value = record?.[name]
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined
}

function fechaDeTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value))
}

function horaDeTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value))
}

/** Compatibilidad exclusiva de presentación: el dominio canónico sigue siendo OperationRead. */
export function convertirOperacionATarea(operation: OperationView): TareaResumen {
  const summary = operationSummary(operation)
  const detail = "operation" in operation ? operation : undefined
  const request = detail?.request.request
  const metadata = recordField(request, "metadata")
  const workOrderEnvelope = detail?.work_orders[0] ?? detail?.visit.work_orders[0]
  const workOrder =
    recordField(workOrderEnvelope, "work_order") ??
    (workOrderEnvelope as Record<string, unknown> | undefined)
  const context = recordField(workOrderEnvelope, "context")
  const planta = recordField(context, "planta")
  const equipo = recordField(context, "equipo")
  const plantaId =
    stringField(planta, "id") ?? stringField(workOrder, "planta_id", "plantaId") ?? ""
  const equipoId =
    stringField(equipo, "id") ?? stringField(workOrder, "equipo_id", "equipoId") ?? ""
  const plantaNombre =
    stringField(planta, "nombre") ?? stringField(workOrder, "planta_nombre", "plantaNombre") ?? "—"
  const equipoNombre =
    stringField(equipo, "nombre") ?? stringField(workOrder, "equipo_nombre", "equipoNombre") ?? "—"

  return {
    id: summary.id,
    nroSolicitud: summary.numero_solicitud,
    empresaId: summary.cliente.id,
    yacimientoId: summary.yacimiento.id,
    plantaId,
    equipoId,
    tallerId: summary.taller_movil?.id,
    contacto: stringField(metadata, "contacto") ?? "",
    telefono: stringField(metadata, "telefono") ?? "",
    fechaSolicitud:
      stringField(request, "created_at", "createdAt") ?? fechaDeTimestamp(summary.starts_at),
    fechaEjecucion: fechaDeTimestamp(summary.starts_at),
    horario: horaDeTimestamp(summary.starts_at),
    tipo: stringField(metadata, "tipo") ?? "Certificación",
    detalle: stringField(metadata, "detalle") ?? "",
    pdRto: stringField(metadata, "pd_rto", "pdRto"),
    ordenTrabajo: stringField(workOrder, "id"),
    condiciones: stringArrayField(metadata, "condiciones") ?? [],
    adjuntos: (metadata?.adjuntos as Adjunto[] | undefined) ?? [],
    estado: ESTADO_OPERACION_A_TAREA[summary.estado],
    empresaNombre: summary.cliente.nombre,
    yacimientoNombre: summary.yacimiento.nombre,
    plantaNombre,
    equipoNombre,
    tallerNombre: summary.taller_movil?.nombre,
    tallerColor: undefined,
  }
}

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
