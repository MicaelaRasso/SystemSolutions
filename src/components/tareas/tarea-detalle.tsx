"use client"

import { Ban, ChevronLeft, RotateCcw } from "lucide-react"
import Link from "next/link"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { fmtFecha } from "@/lib/format"
import { INVALIDAR_TAREAS, useServiceMutation, useTarea } from "@/lib/hooks/queries"
import { services } from "@/lib/services"

import { EstadoTareaBadge, TallerChip } from "./badges"
import { TareaForm } from "./tarea-form"

export function TareaDetalle({ id }: { id: string }) {
  const { data: tarea, isPending, isError, error, refetch } = useTarea(id)
  const cambiarEstado = useServiceMutation(
    (estado: "cancelada" | "pendiente") => services.tareas.update(id, { estado }),
    { invalidar: INVALIDAR_TAREAS },
  )

  const volver = (
    <Link
      href="/admin/tareas"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
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
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-[32rem] w-full max-w-4xl" />
      </>
    )
  }

  const cerrada = tarea.estado === "completada" || tarea.estado === "cancelada"

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
            onClick={() => cambiarEstado.mutate("pendiente")}
          >
            <RotateCcw />
            Reabrir tarea
          </Button>
        ) : (
          !cerrada && (
            <ConfirmDialog
              trigger={
                <Button variant="destructive">
                  <Ban />
                  Cancelar tarea
                </Button>
              }
              titulo={`¿Cancelar la solicitud N° ${tarea.nroSolicitud}?`}
              descripcion="Queda en el historial como cancelada y sale de la agenda del taller. Se puede reabrir."
              confirmar="Cancelar tarea"
              onConfirm={() => cambiarEstado.mutateAsync("cancelada")}
            />
          )
        )}
      </div>
      {/* key: al cambiar el estado desde el encabezado, el formulario toma los valores nuevos */}
      <TareaForm key={`${tarea.id}-${tarea.estado}`} tarea={tarea} />
    </>
  )
}
