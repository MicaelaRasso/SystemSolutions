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
import type { Adjunto } from "@/lib/domain/types"
import { useOperacion, type OperationRead, type OperationSummaryRead } from "@/lib/hooks/queries"
import type { TareaResumen } from "@/lib/services"
import { nombresDePlantas, resumenPlantas } from "@/lib/services/ubicacion-operacion"

import { EstadoTareaBadge, TallerChip } from "./badges"
import { ESTADO_OPERACION_A_TAREA } from "./estado-operacion"
import { telefonoHref } from "./tarea-info"

type OperationView = OperationSummaryRead | OperationRead
type OperationSummaryView = OperationSummaryRead

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

function fechaDeMetadata(record: Record<string, unknown> | undefined, name: string) {
  const value = stringField(record, name)
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

const isUuid = (val: string | undefined) =>
  val ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()) : false

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
  const plantasNombres = nombresDePlantas(summary.plantas)
  const plantaNombre =
    resumenPlantas(plantasNombres) ||
    (stringField(planta, "nombre") ?? stringField(workOrder, "planta_nombre", "plantaNombre") ?? "—")
  const equipoNombre =
    stringField(equipo, "nombre") ?? stringField(workOrder, "equipo_nombre", "equipoNombre") ?? "—"

  const rawOrdenTrabajo =
    stringField(metadata, "orden_trabajo", "ordenTrabajo") ??
    stringField(request, "orden_trabajo", "ordenTrabajo") ??
    (summary as unknown as { orden_trabajo?: string }).orden_trabajo
  const ordenTrabajo = isUuid(rawOrdenTrabajo) ? undefined : (rawOrdenTrabajo?.trim() || undefined)

  return {
    id: summary.id,
    nroSolicitud: summary.numero_solicitud,
    empresaId: summary.cliente.id,
    yacimientoId: summary.yacimiento.id,
    plantaId,
    equipoId,
    tallerId: summary.taller_movil?.id,
    contacto: stringField(metadata, "contacto") ?? summary.contacto ?? "",
    telefono: stringField(metadata, "telefono") ?? summary.telefono ?? "",
    // La fecha cargada en el formulario se guarda en la metadata; si falta se usa `created_at`,
    // que es un timestamp: el formulario y `tareaSchema` esperan YYYY-MM-DD (en -03:00).
    fechaSolicitud:
      fechaDeMetadata(metadata, "fecha_solicitud") ??
      fechaDeTimestamp(stringField(request, "created_at", "createdAt") ?? summary.starts_at),
    fechaEjecucion: fechaDeTimestamp(summary.starts_at),
    horario: horaDeTimestamp(summary.starts_at),
    tipo: stringField(metadata, "tipo") ?? summary.tipo ?? "Certificación",
    detalle: stringField(metadata, "detalle") ?? summary.detalle ?? "",
    pdRto: stringField(metadata, "pd_rto", "pdRto") ?? summary.pd_rto ?? undefined,
    ordenTrabajo,
    condiciones: stringArrayField(metadata, "condiciones") ?? [],
    adjuntos: (metadata?.adjuntos as Adjunto[] | undefined) ?? [],
    estado: ESTADO_OPERACION_A_TAREA[summary.estado],
    empresaNombre: summary.cliente.nombre,
    yacimientoNombre: summary.yacimiento.nombre,
    plantaNombre,
    plantasNombres,
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
  const operacionDetalle = useOperacion(tarea?.id ?? "")
  const actual: TareaResumen | null = tarea
    ? operacionDetalle.data
      ? {
          ...convertirOperacionATarea(operacionDetalle.data),
          tallerColor: tarea.tallerColor,
        }
      : tarea
    : null
  const telHref = actual ? telefonoHref(actual.telefono) : undefined

  return (
    <Sheet open={!!actual} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        {actual && (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <EstadoTareaBadge estado={actual.estado} />
                <Badge variant="outline">{actual.tipo}</Badge>
              </div>
              <SheetTitle className="text-lg">Solicitud N° {actual.nroSolicitud}</SheetTitle>
              <SheetDescription>{actual.empresaNombre}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto px-4">
              <Dato icono={Clock}>
                <span className="inline-block first-letter:uppercase">
                  {fmtDiaLargo(actual.fechaEjecucion)}
                </span>
                {actual.horario && (
                  <span className="text-muted-foreground"> · {actual.horario} h</span>
                )}
              </Dato>
              <Dato icono={MapPin}>
                <div className="font-medium">{actual.plantaNombre}</div>
                <div className="text-muted-foreground">
                  {actual.yacimientoNombre}
                  {actual.equipoNombre && actual.equipoNombre !== "—" && (
                    <> · Equipo {actual.equipoNombre}</>
                  )}
                </div>
              </Dato>
              <Dato icono={User}>
                <TallerChip nombre={actual.tallerNombre} color={actual.tallerColor} />
              </Dato>
              <Dato icono={Phone}>
                {actual.contacto || actual.telefono ? (
                  <div className="flex flex-wrap items-center gap-1">
                    {actual.contacto && <span>{actual.contacto}</span>}
                    {actual.contacto && actual.telefono && <span aria-hidden>·</span>}
                    {actual.telefono &&
                      (telHref ? (
                        <a
                          href={telHref}
                          className="tabular-nums underline-offset-2 hover:underline"
                        >
                          {actual.telefono}
                        </a>
                      ) : (
                        <span className="tabular-nums">{actual.telefono}</span>
                      ))}
                  </div>
                ) : (
                  <span className="text-muted-foreground">Sin teléfono ni contacto registrado</span>
                )}
              </Dato>
              <Dato icono={FileText}>
                <p className="whitespace-pre-line">
                  {actual.detalle || (
                    <span className="text-muted-foreground">Sin detalle de servicio</span>
                  )}
                </p>
                {((actual.ordenTrabajo && !isUuid(actual.ordenTrabajo)) || actual.pdRto) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {actual.ordenTrabajo && !isUuid(actual.ordenTrabajo) && `OT ${actual.ordenTrabajo}`}
                    {actual.ordenTrabajo && !isUuid(actual.ordenTrabajo) && actual.pdRto && " · "}
                    {actual.pdRto && `PD/RTO ${actual.pdRto}`}
                  </p>
                )}
              </Dato>
              {actual.condiciones.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {actual.condiciones.map((c) => (
                    <Badge key={c} variant="secondary" className="font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
              {actual.adjuntos.length > 0 && (
                <Dato icono={Paperclip}>
                  {actual.adjuntos.map((a) => (
                    <div key={a.id} className="truncate">
                      {a.nombre}
                    </div>
                  ))}
                </Dato>
              )}
            </div>
            <SheetFooter>
              <Button asChild>
                <Link href={`/admin/tareas/${actual.id}`}>
                  <Pencil />
                  Ver solicitud y visita
                </Link>
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
