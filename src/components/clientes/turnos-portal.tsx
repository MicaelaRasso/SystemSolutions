"use client"

import { useMemo, useState } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { Input } from "@/components/ui/input"
import { useEdgeServiceRequests, useEdgeVisits } from "@/lib/api/hooks"
import { fmtFechaHora } from "@/lib/format"

const estadoLabel: Record<string, string> = {
  solicitada: "Solicitada",
  programada: "Programada",
  aceptada: "Aceptada",
  en_curso: "En curso",
  completada: "Completada",
  cancelada: "Cancelada",
}

export function TurnosPortal() {
  const requests = useEdgeServiceRequests()
  const visits = useEdgeVisits()
  const visitItems = visits.data
  const [search, setSearch] = useState("")
  const grouped = useMemo(() => {
    const visitsByRequest = new Map<string, NonNullable<typeof visitItems>>()
    for (const item of visitItems ?? []) {
      const requestId = String(item.visit.solicitud_id ?? "")
      if (!requestId) continue
      visitsByRequest.set(requestId, [...(visitsByRequest.get(requestId) ?? []), item])
    }
    return (requests.data ?? []).flatMap((item) => {
      const requestVisits = visitsByRequest.get(String(item.request.id))
      return requestVisits ? [{ ...item, visits: requestVisits }] : []
    })
  }, [requests.data, visitItems])

  const loading = requests.isPending || visits.isPending
  const error = requests.error ?? visits.error
  const filtered = grouped.filter((item) => {
    const haystack = [
      item.request.numero_solicitud,
      item.request.id,
      item.request.estado,
      ...(item.selected_valves ?? []).map((valve) => valve.name),
      ...item.visits.map(({ visit }) => visit.estado),
    ].join(" ").toLocaleLowerCase()
    return haystack.includes(search.trim().toLocaleLowerCase())
  })

  if (loading) return <div className="rounded-xl border p-8 text-sm text-muted-foreground">Cargando turnos…</div>
  if (error) return <ErrorState error={error} onRetry={() => { void requests.refetch(); void visits.refetch() }} />

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Turnos</h1>
        <p className="text-sm text-muted-foreground">Cada Solicitud reúne sus visitas y las válvulas atendidas en cada fecha.</p>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Buscar por solicitud, estado o válvula"
        aria-label="Buscar turnos"
      />
      {filtered.length === 0 ? (
        <EmptyState titulo={search ? "No hay turnos que coincidan" : "Todavía no tienes turnos"} descripcion={search ? "Prueba con otro número de solicitud o válvula." : "Cuando programes un servicio, sus visitas aparecerán aquí."} />
      ) : (
        <div className="space-y-4">
          {filtered.map(({ request, selected_valves, visits: requestVisits }) => {
            const valvesById = new Map(selected_valves.map((valve) => [valve.id, valve.name]))
            const number = String(request.numero_solicitud ?? request.id)
            return (
              <section key={String(request.id)} className="space-y-3 rounded-xl border p-4" aria-label={`Solicitud ${number}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-semibold">Solicitud N° {number}</h2>
                    <p className="text-sm text-muted-foreground">Estado: {estadoLabel[String(request.estado)] ?? String(request.estado ?? "Pendiente")}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{requestVisits.length} {requestVisits.length === 1 ? "visita" : "visitas"}</span>
                </div>
                {requestVisits.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aún no hay una visita programada.</p>
                ) : (
                  <ol className="space-y-3">
                    {requestVisits
                      .slice()
                      .sort((a, b) => String(a.visit.starts_at).localeCompare(String(b.visit.starts_at)))
                      .map(({ visit, work_orders }) => (
                        <li key={String(visit.id)} className="rounded-lg bg-muted/40 p-3">
                          <div className="flex flex-wrap justify-between gap-2">
                            <p className="text-sm font-medium">
                              {visit.starts_at ? fmtFechaHora(String(visit.starts_at)) : "Fecha a confirmar"}
                              {visit.ends_at ? ` – ${fmtFechaHora(String(visit.ends_at))}` : ""}
                            </p>
                            <span className="text-sm">{estadoLabel[String(visit.estado)] ?? String(visit.estado ?? "")}</span>
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">Válvulas de esta visita</p>
                          <ul className="mt-1 flex flex-wrap gap-2">
                            {work_orders.map((order, index) => {
                              const valveId = String(order.valvula_id ?? "")
                              return <li key={String(order.id ?? `${valveId}-${index}`)} className="rounded-full border px-2.5 py-1 text-xs">{valvesById.get(valveId) ?? valveId}</li>
                            })}
                          </ul>
                        </li>
                      ))}
                  </ol>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
