"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useCreateEdgeFollowupVisit, useEdgeVisits } from "@/lib/api/hooks"
import { mensajeError, useTalleres } from "@/lib/hooks/queries"
import type { OperationRead } from "@/lib/hooks/queries"
import { finEstimadoValido, horaFinPropuesta, MENSAJE_FIN_ESTIMADO } from "@/lib/domain/rules"

/**
 * Inicio y fin estimado de la visita interpretados en hora argentina (-03:00), como el resto de la
 * app. El fin estimado reserva el equipo pero no cierra la visita (decisión (e)). Sin fin, una hora.
 */
export function ventanaSeguimiento(date: string, time: string, endTime?: string) {
  const fin = endTime || horaFinPropuesta(time)
  const starts = new Date(`${date}T${time}:00-03:00`)
  const ends = new Date(`${date}T${fin}:00-03:00`)
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return undefined
  if (!finEstimadoValido(time, fin)) return undefined
  return { startsAt: starts.toISOString(), endsAt: ends.toISOString() }
}

/** Se evalúa solo al enviar, fuera del render. */
const esFutura = (iso: string) => new Date(iso).getTime() > Date.now()

export function VisitaSeguimientoForm({ operation }: { operation: OperationRead }) {
  const router = useRouter()
  const visits = useEdgeVisits()
  const talleres = useTalleres()
  const createVisit = useCreateEdgeFollowupVisit()
  /** null = selección por defecto: todas las válvulas candidatas. */
  const [seleccion, setSeleccion] = useState<string[] | null>(null)
  const [tallerMovilId, setTallerMovilId] = useState(
    () => operation.operation.taller_movil?.id ?? "",
  )
  const [date, setDate] = useState("")
  const [time, setTime] = useState("09:00")
  const [endTime, setEndTime] = useState(horaFinPropuesta("09:00"))
  const requestId = String(operation.visit.visit.solicitud_id ?? "")
  const sourceVisitId = String(operation.visit.visit.id ?? "")
  const activeStatuses = new Set([
    "solicitada",
    "programada",
    "aceptada",
    "en_curso",
    "requiere_finalizacion",
  ])
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
  const pendingOrders = operation.work_orders.filter(
    ({ work_order }) => work_order.estado === "no_evaluada",
  )
  // Mientras no se conocen las visitas activas no se ofrece ninguna válvula: podría estar ya
  // incluida en otra visita de seguimiento.
  const candidates = visits.isPending
    ? []
    : pendingOrders.filter(({ work_order }) => !alreadyAssigned.has(work_order.valvula_id ?? ""))
  const candidateIds = candidates
    .map(({ work_order }) => work_order.valvula_id)
    .filter((id): id is string => Boolean(id))
  // Derivada en el render (sin efecto): por defecto todas las candidatas, y nunca una válvula que
  // dejó de serlo.
  const valveIds = (seleccion ?? candidateIds).filter((id) => candidateIds.includes(id))

  if (!requestId || !sourceVisitId || pendingOrders.length === 0) return null

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!date || !time || !endTime || !tallerMovilId || valveIds.length === 0) {
      toast.error("Selecciona las válvulas, el Taller Móvil y la fecha de la visita")
      return
    }
    if (!finEstimadoValido(time, endTime)) {
      toast.error(MENSAJE_FIN_ESTIMADO)
      return
    }
    const ventana = ventanaSeguimiento(date, time, endTime)
    if (!ventana || !esFutura(ventana.startsAt)) {
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
          ...ventana,
        },
      })
      toast.success("Visita de seguimiento creada para la misma solicitud")
      router.push(`/admin/tareas/${result.visit.id}`)
    } catch (error) {
      toast.error(mensajeError(error))
    }
  }

  return (
    <section className="max-w-4xl space-y-4 rounded-xl border border-amber-300/60 bg-amber-50/40 p-4 dark:bg-amber-950/20">
      <div>
        <h2 className="font-semibold text-amber-950 dark:text-amber-200">
          Visita no terminada · Programar visita para válvulas pendientes ({pendingOrders.length})
        </h2>
        <p className="text-sm text-muted-foreground">
          La nueva visita queda dentro de la Solicitud actual para que el Cliente vea todos sus
          certificados juntos bajo el mismo servicio.
        </p>
      </div>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">Válvulas no evaluadas</legend>
          {candidates.map(({ work_order, valve, context }) => (
            <label key={work_order.valvula_id} className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={valveIds.includes(work_order.valvula_id ?? "")}
                onChange={(event) =>
                  setSeleccion(
                    event.target.checked
                      ? [...valveIds, work_order.valvula_id!]
                      : valveIds.filter((id) => id !== work_order.valvula_id),
                  )
                }
              />
              <span className="font-medium">
                Válvula {valve.nombre}
                {context?.equipo?.nombre ? ` · Equipo ${context.equipo.nombre}` : ""}
              </span>
              {work_order.no_evaluada_razon ? (
                <span className="text-xs text-muted-foreground">
                  ({work_order.no_evaluada_razon})
                </span>
              ) : null}
            </label>
          ))}
          {visits.isPending && (
            <p className="text-xs text-muted-foreground">Comprobando visitas activas…</p>
          )}
          {!visits.isPending && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Todas las válvulas pendientes ya están asignadas a otra visita activa.
            </p>
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
            {(talleres.data ?? [])
              .filter((item) => item.activo)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.nombre}
                </option>
              ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="grid gap-1 text-sm">
            Fecha
            <input
              required
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Inicio
            <input
              required
              type="time"
              value={time}
              onChange={(event) => {
                setTime(event.target.value)
                setEndTime(horaFinPropuesta(event.target.value))
              }}
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Hora de fin estimada
            <input
              required
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              className="h-9 rounded-md border bg-background px-3"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">
          El equipo queda reservado entre el inicio y el fin estimado (se propone una hora). El fin
          estimado no cierra la visita: la completa el técnico.
        </p>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            disabled={createVisit.isPending || valveIds.length === 0 || candidates.length === 0}
          >
            {createVisit.isPending ? "Programando…" : "Crear visita de seguimiento"}
          </Button>
        </div>
      </form>
    </section>
  )
}
