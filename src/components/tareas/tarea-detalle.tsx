"use client"

import { Ban, ChevronLeft, RotateCcw } from "lucide-react"
import Link from "next/link"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { useMotivo } from "@/components/common/motivo-dialog"
import { ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Cargando } from "@/components/common/cargando"
import { fmtFecha } from "@/lib/format"
import { useEdgeVisits } from "@/lib/api/hooks"
import {
  cancelarVisita,
  cambiarEstadoTarea,
  INVALIDAR_TAREAS,
  usaSupabase,
  useServiceMutation,
  useOperacion,
  useTarea,
} from "@/lib/hooks/queries"
import type { OperationRead } from "@/lib/hooks/queries"

import { EstadoTareaBadge, TallerChip } from "./badges"
import { TareaForm } from "./tarea-form"
import { convertirOperacionATarea } from "./tarea-sheet"
import { puedeCancelarVisitaAdministrativa, puedeEditarProgramacion } from "./estado-operacion"
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

/**
 * Vista de solo lectura para el Administrador: el resultado de cada válvula y su borrador de
 * certificado los carga el Taller Móvil asignado desde su panel (el servidor rechaza al resto).
 */
function OrdenesTrabajo({ operation }: { operation: OperationRead }) {
  const metadata = (operation.request?.request?.metadata ?? {}) as Record<string, unknown>
  const rawOt = typeof metadata.orden_trabajo === "string" ? metadata.orden_trabajo.trim() : ""
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOt)
  const otGeneral = !isUuid && rawOt ? rawOt : undefined

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
          El resultado de cada válvula y su certificado los carga el Taller Móvil desde su panel.
        </p>
      </div>
      {selectedValves.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          La solicitud no tiene válvulas seleccionadas.
        </p>
      ) : (
        <ul className="space-y-3">
          {selectedValves.map((valve) => {
            const entry = orderForValve(valve.id)
            const estado = entry?.work_order.estado
            const motivo =
              estado === "no_evaluada"
                ? String(entry?.work_order.no_evaluada_razon ?? "").trim()
                : ""
            return (
              <li key={valve.id} className="rounded-lg bg-muted/40 p-3">
                <p className="text-sm font-medium">{valve.name}</p>
                <p className="text-xs text-muted-foreground">
                  {otGeneral ? `OT ${otGeneral} · ` : ""}
                  {!entry
                    ? "Sin orden en esta visita"
                    : estado === "evaluada"
                      ? "Evaluada"
                      : estado === "no_evaluada"
                        ? `No evaluada${motivo ? ` · ${motivo}` : ""}`
                        : "Pendiente"}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
