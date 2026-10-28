"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useCreateEdgeFollowupVisit, useEdgeVisits } from "@/lib/api/hooks"
import { mensajeError, useTalleres } from "@/lib/hooks/queries"
import type { OperationRead } from "@/lib/hooks/queries"

export function VisitaSeguimientoForm({ operation }: { operation: OperationRead }) {
  const router = useRouter()
  const visits = useEdgeVisits()
  const talleres = useTalleres()
  const createVisit = useCreateEdgeFollowupVisit()
  const [valveIds, setValveIds] = useState<string[]>([])
  const [tallerMovilId, setTallerMovilId] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("09:00")
  const requestId = String(operation.visit.visit.solicitud_id ?? "")
  const sourceVisitId = String(operation.visit.visit.id ?? "")
  const activeStatuses = new Set(["solicitada", "programada", "aceptada", "en_curso"])
  const alreadyAssigned = new Set(
    (visits.data ?? [])
      .filter(
        ({ visit }) =>
          visit.solicitud_id === requestId &&
          visit.id !== sourceVisitId &&
          activeStatuses.has(String(visit.estado)),
      )
      .flatMap(({ work_orders }) => work_orders.map((order) => order.valvula_id).filter(Boolean)),
  )
  const pendingOrders = operation.work_orders.filter(({ work_order }) => work_order.estado === "no_evaluada")
  const candidates = pendingOrders.filter(
    ({ work_order }) => !alreadyAssigned.has(work_order.valvula_id ?? ""),
  )

  if (!requestId || !sourceVisitId || pendingOrders.length === 0) return null

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!date || !time || !tallerMovilId || valveIds.length === 0) {
      toast.error("Selecciona las válvulas, el Taller Móvil y la fecha de la visita")
      return
    }
    const starts = new Date(`${date}T${time}`)
    const ends = new Date(starts.getTime() + 60 * 60 * 1000)
    if (Number.isNaN(starts.getTime()) || starts.getTime() <= Date.now()) {
      toast.error("La visita debe programarse para una fecha futura")
      return
    }
    try {
      const result = await createVisit.mutateAsync({
        requestId,
        input: {
          sourceVisitId,
          valveIds,
          tallerMovilId,
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
        },
      })
      toast.success("Visita de seguimiento creada para la misma solicitud")
      router.push(`/admin/tareas/${result.visit.id}`)
    } catch (error) {
      toast.error(mensajeError(error))
    }
  }

  return (
    <section className="max-w-4xl space-y-4 rounded-xl border p-4">
      <div>
        <h2 className="font-semibold">Programar visita para válvulas pendientes</h2>
        <p className="text-sm text-muted-foreground">
          La nueva visita queda dentro de la Solicitud actual y conserva el historial de esta visita.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">Válvulas no evaluadas</legend>
          {candidates.map(({ work_order, valve }) => (
            <label key={work_order.valvula_id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={valveIds.includes(work_order.valvula_id ?? "")}
                onChange={(event) =>
                  setValveIds((current) =>
                    event.target.checked
                      ? [...current, work_order.valvula_id!]
                      : current.filter((id) => id !== work_order.valvula_id),
                  )
                }
              />
              {valve.nombre}
            </label>
          ))}
          {visits.isPending && <p className="text-xs text-muted-foreground">Comprobando visitas activas…</p>}
          {candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">Todas las válvulas pendientes ya están asignadas a otra visita activa.</p>
          )}
        </fieldset>
        <label className="grid gap-1 text-sm">
          Taller Móvil
          <select
            required
            value={tallerMovilId}
            onChange={(event) => setTallerMovilId(event.target.value)}
            className="h-9 rounded-md border bg-background px-3"
          >
            <option value="">Seleccionar taller</option>
            {(talleres.data ?? []).filter((item) => item.activo).map((item) => (
              <option key={item.id} value={item.id}>{item.nombre}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-sm">
            Fecha
            <input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-md border bg-background px-3" />
          </label>
          <label className="grid gap-1 text-sm">
            Inicio
            <input required type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-9 rounded-md border bg-background px-3" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">Se reserva una ventana inicial de una hora; luego puede ajustarse desde la administración de visitas.</p>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={createVisit.isPending || valveIds.length === 0 || candidates.length === 0}>
            {createVisit.isPending ? "Programando…" : "Crear visita de seguimiento"}
          </Button>
        </div>
      </form>
    </section>
  )
}
