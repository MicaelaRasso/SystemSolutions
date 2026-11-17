"use client"

import { Ban, ChevronLeft, RotateCcw } from "lucide-react"
import Link from "next/link"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { CertificateCaptureForm } from "@/components/certificados/certificate-capture-form"
import { useMotivo } from "@/components/common/motivo-dialog"
import { ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Cargando } from "@/components/common/cargando"
import { fmtFecha } from "@/lib/format"
import {
  useAddEdgeWorkOrder,
  useEdgeCertificateCaptureCatalogs,
  useEdgeCertificateDraft,
  useEdgeVisits,
  useStartEdgeCertificateDraft,
  useUpdateEdgeCertificateDraft,
  useUpdateEdgeWorkOrder,
} from "@/lib/api/hooks"
import {
  cancelarVisita,
  cambiarEstadoTarea,
  INVALIDAR_TAREAS,
  usaSupabase,
  useServiceMutation,
  useOperacion,
  useTarea,
} from "@/lib/hooks/queries"
import { useState } from "react"
import type { OperationRead } from "@/lib/hooks/queries"

import { EstadoTareaBadge, TallerChip } from "./badges"
import { TareaForm } from "./tarea-form"
import { convertirOperacionATarea } from "./tarea-sheet"
import {
  puedeCancelarVisitaAdministrativa,
  puedeEditarProgramacion,
  puedeEvaluarOrden,
} from "./estado-operacion"
import { CierreVisitaVencida } from "./cierre-visita-vencida"
import { VisitaSeguimientoForm } from "./visita-seguimiento-form"

export function TareaDetalle({ id }: { id: string }) {
  const supabase = usaSupabase()
  const operacion = useOperacion(id)
  const tareaLegacy = useTarea(id)
  const tarea = supabase
    ? operacion.data
      ? convertirOperacionATarea(operacion.data)
      : undefined
    : tareaLegacy.data
  const isPending = supabase ? operacion.isPending : tareaLegacy.isPending
  const isError = supabase ? operacion.isError : tareaLegacy.isError
  const error = supabase ? operacion.error : tareaLegacy.error
  const refetch = supabase ? operacion.refetch : tareaLegacy.refetch
  const cambiarEstado = useServiceMutation(
    (input: { estado: "cancelada" | "pendiente"; reason?: string }) =>
      supabase && input.estado === "cancelada"
        ? cancelarVisita(id, input.reason ?? "")
        : cambiarEstadoTarea(id, input.estado),
    { invalidar: INVALIDAR_TAREAS },
  )
  const { pedirMotivo, dialogo: dialogoMotivo } = useMotivo()

  /** Con Supabase el motivo es obligatorio: el propio diálogo hace de confirmación. */
  async function cancelarConMotivo() {
    if (!tarea) return
    const reason = await pedirMotivo({
      titulo: `¿Cancelar la solicitud N° ${tarea.nroSolicitud}?`,
      descripcion: "Queda en el historial como cancelada y sale de la agenda del taller.",
      etiqueta: "Motivo de cancelación de la visita",
      confirmar: "Cancelar tarea",
      destructivo: true,
    })
    if (!reason) return
    try {
      await cambiarEstado.mutateAsync({ estado: "cancelada", reason })
    } catch {
      // El error ya se notificó (toast).
    }
  }

  const volver = (
    <Link
      href="/admin/tareas"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
    >
      <ChevronLeft className="size-4" />
      Tareas
    </Link>
  )

  if (isError) {
    return (
      <>
        {volver}
        <ErrorState error={error} onRetry={() => refetch()} />
      </>
    )
  }
  if (isPending) {
    return (
      <>
        {volver}
        <Cargando texto="Cargando tarea…" />
      </>
    )
  }
  if (!tarea) {
    return (
      <>
        {volver}
        <ErrorState error={new Error("No se encontró la operación")} onRetry={() => refetch()} />
      </>
    )
  }

  const cerrada = tarea.estado === "completada" || tarea.estado === "cancelada"
  const cancelable = supabase
    ? Boolean(operacion.data?.visit.visit.id) &&
      puedeCancelarVisitaAdministrativa(operacion.data!.operation.estado)
    : !cerrada

  return (
    <>
      {volver}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Solicitud N° {tarea.nroSolicitud}
            </h1>
            <EstadoTareaBadge estado={tarea.estado} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
            <span>
              {tarea.empresaNombre} · {tarea.plantaNombre}
            </span>
            <TallerChip nombre={tarea.tallerNombre} color={tarea.tallerColor} />
            <span>Solicitada el {fmtFecha(tarea.fechaSolicitud)}</span>
          </p>
        </div>
        {tarea.estado === "cancelada" ? (
          <Button
            variant="outline"
            disabled={cambiarEstado.isPending}
            onClick={() => cambiarEstado.mutate({ estado: "pendiente" })}
          >
            <RotateCcw />
            Reactivar tarea
          </Button>
        ) : (
          cancelable &&
          (supabase ? (
            <>
              <Button
                variant="destructive"
                disabled={cambiarEstado.isPending}
                onClick={cancelarConMotivo}
              >
                <Ban />
                Cancelar tarea
              </Button>
              {dialogoMotivo}
            </>
          ) : (
            <ConfirmDialog
              trigger={
                <Button variant="destructive">
                  <Ban />
                  Cancelar tarea
                </Button>
              }
              titulo={`¿Cancelar la solicitud N° ${tarea.nroSolicitud}?`}
              descripcion="Queda en el historial como cancelada y sale de la agenda del taller."
              confirmar="Cancelar tarea"
              onConfirm={() => cambiarEstado.mutateAsync({ estado: "cancelada" })}
            />
          ))
        )}
      </div>
      {/* key: al cambiar el estado desde el encabezado, el formulario toma los valores nuevos */}
      {(!supabase ||
        (operacion.data && puedeEditarProgramacion(operacion.data.operation.estado))) && (
        <TareaForm
          key={`${tarea.id}-${tarea.estado}`}
          tarea={tarea}
          operation={supabase ? operacion.data : undefined}
        />
      )}
      {supabase && operacion.data && !puedeEditarProgramacion(operacion.data.operation.estado) && (
        <p className="text-sm text-muted-foreground">
          La Visita de servicio ya no admite cambios de programación o selección.
        </p>
      )}
      {supabase && operacion.data?.visit.visit.estado === "requiere_finalizacion" && (
        <CierreVisitaVencida operation={operacion.data} />
      )}
      {supabase && operacion.data && <OrdenesTrabajo operation={operacion.data} />}
      {supabase && operacion.data?.visit.visit.estado === "completada" && (
        <VisitaSeguimientoForm operation={operacion.data} />
      )}
    </>
  )
}

function OrdenesTrabajo({ operation }: { operation: OperationRead }) {
  const metadata = (operation.request?.request?.metadata ?? {}) as Record<string, unknown>
  const rawOt = typeof metadata.orden_trabajo === "string" ? metadata.orden_trabajo.trim() : ""
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOt)
  const otGeneral = !isUuid && rawOt ? rawOt : undefined

  const puedeEvaluar =
    puedeEvaluarOrden(operation.operation.estado) &&
    puedeEvaluarOrden(operation.visit.visit.estado)

  const add = useAddEdgeWorkOrder()
  const update = useUpdateEdgeWorkOrder()
  const visits = useEdgeVisits()
  const visitId = operation.visit.visit.id
  const hasSiblingVisits = (visits.data ?? []).some(
    ({ visit }) =>
      visit.solicitud_id === operation.visit.visit.solicitud_id && visit.id !== visitId,
  )
  const limitToVisitScope = visits.isPending || visits.isError || hasSiblingVisits
  const selectedValves = operation.request.selected_valves.filter(
    (valve) =>
      !limitToVisitScope ||
      operation.work_orders.some(({ work_order }) => work_order.valvula_id === valve.id),
  )
  const orderForValve = (valveId: string) =>
    operation.work_orders.find((entry) => entry.work_order.valvula_id === valveId)

  return (
    <section className="max-w-4xl space-y-3 rounded-xl border p-4" aria-labelledby="ordenes-title">
      <div>
        <h2 id="ordenes-title" className="font-semibold">
          Órdenes de trabajo
        </h2>
        <p className="text-sm text-muted-foreground">
          Se administran dentro de la visita asociada.
        </p>
        {visits.isPending && (
          <p className="text-sm text-muted-foreground">
            Verificando las válvulas asignadas a otras visitas…
          </p>
        )}
        {visits.isError && (
          <p role="alert" className="text-sm text-destructive">
            No se pudo verificar el alcance de esta visita. Reintenta antes de agregar órdenes.
            <Button type="button" variant="link" size="sm" onClick={() => void visits.refetch()}>
              Reintentar
            </Button>
          </p>
        )}
      </div>
      {selectedValves.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          La solicitud no tiene válvulas seleccionadas.
        </p>
      ) : (
        <ul className="space-y-3">
          {selectedValves.map((valve) => {
            const entry = orderForValve(valve.id)
            return (
              <li
                key={valve.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3"
              >
                <div>
                  <p className="text-sm font-medium">{valve.name}</p>
                  {entry && (
                    <p className="text-xs text-muted-foreground">
                      {otGeneral ? `OT ${otGeneral} · ` : ""}
                      <span className="capitalize">
                        {entry.work_order.estado === "no_evaluada"
                          ? "No evaluada"
                          : entry.work_order.estado ?? "pendiente"}
                      </span>
                    </p>
                  )}
                </div>
                {entry ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {entry.work_order.estado !== "evaluada" && puedeEvaluar && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="pointer-coarse:h-11"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({
                              workOrderId: entry.work_order.id,
                              input: { outcome: "evaluada" },
                            })
                          }
                        >
                          Marcar evaluada
                        </Button>
                      )}
                      {entry.work_order.estado !== "no_evaluada" && puedeEvaluar && (
                        <NoEvaluadaButton
                          disabled={update.isPending}
                          onSubmit={(reason) =>
                            update.mutate({
                              workOrderId: entry.work_order.id,
                              input: { outcome: "no_evaluada", notEvaluatedReason: reason },
                            })
                          }
                        />
                      )}
                    </div>
                    {puedeEvaluar && (
                      <CertificateDraft workOrderId={entry.work_order.id} valve={entry.valve} />
                    )}
                  </div>
                ) : puedeEvaluar ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="pointer-coarse:h-11"
                    disabled={add.isPending || visits.isPending || visits.isError}
                    onClick={() => add.mutate({ visitId, valveId: valve.id })}
                  >
                    Agregar orden
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      {add.isError && (
        <p role="alert" className="text-sm text-destructive">
          {add.error.message}
        </p>
      )}
      {update.isError && (
        <p role="alert" className="text-sm text-destructive">
          {update.error.message}
        </p>
      )}
    </section>
  )
}

function CertificateDraft({
  workOrderId,
  valve,
}: {
  workOrderId: string
  valve?: Record<string, unknown>
}) {
  const [certificateId, setCertificateId] = useState<string>()
  const start = useStartEdgeCertificateDraft()
  const draft = useEdgeCertificateDraft(certificateId)
  const catalogs = useEdgeCertificateCaptureCatalogs()
  const save = useUpdateEdgeCertificateDraft()

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="ghost"
        className="pointer-coarse:h-11"
        disabled={start.isPending || draft.isFetching}
        onClick={() => {
          if (certificateId) {
            void draft.refetch()
          } else {
            start.mutate(workOrderId, {
              onSuccess: (result) => setCertificateId(result.certificate.id),
            })
          }
        }}
      >
        {certificateId ? "Leer borrador" : "Iniciar borrador de certificado"}
      </Button>
      {start.isError && (
        <p role="alert" className="text-xs text-destructive">
          {start.error.message}
        </p>
      )}
      {draft.data && (
        <div className="max-w-xl space-y-2" aria-live="polite">
          <p className="text-xs text-muted-foreground">
            {draft.data.validation.complete
              ? "Borrador completo según la validación del servidor."
              : `Campos pendientes: ${draft.data.validation.missing_fields.join(", ") || "sin detalle"}`}
          </p>
          {catalogs.data ? (
            <CertificateCaptureForm
              key={`${certificateId}-${String(draft.data.certificate.updated_at ?? "loaded")}`}
              template={catalogs.data.template}
              catalogs={catalogs.data}
              technicians={[]}
              certificate={draft.data.certificate}
              valve={valve}
              disabled={
                String((draft.data.certificate as Record<string, unknown>).estado_captura) ===
                "cerrado"
              }
              onSave={(input) => save.mutate({ certificateId: certificateId!, input })}
            />
          ) : (
            <Cargando variante="linea" texto="Cargando la plantilla y catálogos del certificado…" />
          )}
          {save.isError && (
            <p role="alert" className="text-xs text-destructive">
              {save.error.message}
            </p>
          )}
          {save.isSuccess && <p className="text-xs text-muted-foreground">Borrador guardado.</p>}
        </div>
      )}
      {draft.isError && (
        <p role="alert" className="text-xs text-destructive">
          {draft.error.message}
        </p>
      )}
    </div>
  )
}

function NoEvaluadaButton({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState("")
  return (
    <div className="flex flex-wrap gap-2">
      <Input
        aria-label="Motivo de no evaluación"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Motivo requerido"
        className="h-8 min-w-0 flex-1 sm:w-40 sm:flex-none"
      />
      <Button
        size="sm"
        variant="outline"
        className="pointer-coarse:h-11"
        disabled={disabled || !reason.trim()}
        onClick={() => onSubmit(reason.trim())}
      >
        No evaluada
      </Button>
    </div>
  )
}
