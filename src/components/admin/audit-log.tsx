"use client"

import { useState } from "react"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AuditFilters } from "@/lib/api/observability"
import { useEdgeAuditEvents } from "@/lib/api/hooks"

const PAGE_SIZE = 50

const filterClassName = "space-y-1 text-sm font-medium"
const fieldClassName = "w-full"

export function AuditLog() {
  const [draftFilters, setDraftFilters] = useState<AuditFilters>({})
  const [filters, setFilters] = useState<AuditFilters>({ limit: PAGE_SIZE, offset: 0 })
  const query = useEdgeAuditEvents(filters)
  const updateFilter = <Key extends keyof AuditFilters>(key: Key, value: AuditFilters[Key]) => {
    setDraftFilters((current) => ({ ...current, [key]: value || undefined }))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Registro de auditoría"
        descripcion="Actividad administrativa ordenada por recepción del servidor."
      />

      <section aria-label="Filtros de auditoría" className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={filterClassName}>
          Desde
          <Input type="date" value={draftFilters.from ?? ""} onChange={(event) => updateFilter("from", event.target.value)} className={fieldClassName} />
        </label>
        <label className={filterClassName}>
          Hasta
          <Input type="date" value={draftFilters.to ?? ""} onChange={(event) => updateFilter("to", event.target.value)} className={fieldClassName} />
        </label>
        <label className={filterClassName}>
          Actor (ID de cuenta)
          <Input value={draftFilters.actorId ?? ""} onChange={(event) => updateFilter("actorId", event.target.value.trim())} className={fieldClassName} placeholder="UUID" />
        </label>
        <label className={filterClassName}>
          Acción
          <Input value={draftFilters.action ?? ""} onChange={(event) => updateFilter("action", event.target.value.trim())} className={fieldClassName} placeholder="visita_completada" />
        </label>
        <label className={filterClassName}>
          Tipo de objetivo
          <Input value={draftFilters.targetType ?? ""} onChange={(event) => updateFilter("targetType", event.target.value.trim())} className={fieldClassName} placeholder="visita_servicio" />
        </label>
        <label className={filterClassName}>
          Resultado
          <select value={draftFilters.outcome ?? ""} onChange={(event) => updateFilter("outcome", (event.target.value || undefined) as AuditFilters["outcome"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">Todos</option>
            <option value="exitoso">Exitoso</option>
            <option value="fallido">Fallido</option>
          </select>
        </label>
        <label className={filterClassName}>
          Cliente (ID de cuenta)
          <Input value={draftFilters.clientId ?? ""} onChange={(event) => updateFilter("clientId", event.target.value.trim())} className={fieldClassName} placeholder="UUID" />
        </label>
        <label className={filterClassName}>
          Yacimiento (ID)
          <Input value={draftFilters.yacimientoId ?? ""} onChange={(event) => updateFilter("yacimientoId", event.target.value.trim())} className={fieldClassName} placeholder="UUID" />
        </label>
        <label className={filterClassName}>
          Visita de servicio (ID)
          <Input value={draftFilters.visitId ?? ""} onChange={(event) => updateFilter("visitId", event.target.value.trim())} className={fieldClassName} placeholder="UUID" />
        </label>
        <label className={filterClassName}>
          Certificado (ID)
          <Input value={draftFilters.certificateId ?? ""} onChange={(event) => updateFilter("certificateId", event.target.value.trim())} className={fieldClassName} placeholder="UUID" />
        </label>
        <div className="flex items-end gap-2 lg:col-span-4">
          <Button onClick={() => setFilters({ ...draftFilters, limit: PAGE_SIZE, offset: 0 })}>Aplicar filtros</Button>
          <Button variant="outline" onClick={() => { setDraftFilters({}); setFilters({ limit: PAGE_SIZE, offset: 0 }) }}>Limpiar filtros</Button>
        </div>
      </section>

      {query.isLoading && <div className="h-48 animate-pulse rounded-xl bg-muted" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState titulo="Sin eventos" descripcion="Las lecturas ordinarias no generan eventos de auditoría." />}

      {query.data && query.data.items.length > 0 && (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recepción del servidor</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead>Objetivo</TableHead>
                  <TableHead>Resultado</TableHead>
                  <TableHead><span className="sr-only">Detalle</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.items.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>
                      <time dateTime={event.recibida_en}>{new Date(event.recibida_en).toLocaleString("es-AR")}</time>
                      {event.evento_dispositivo_en && <div className="text-xs text-muted-foreground">Evento en dispositivo: <time dateTime={event.evento_dispositivo_en}>{new Date(event.evento_dispositivo_en).toLocaleString("es-AR")}</time></div>}
                    </TableCell>
                    <TableCell>{event.actor_email || event.actor_cuenta_id || "Sistema"}{event.actor_rol && <div className="text-xs text-muted-foreground">{event.actor_rol}</div>}</TableCell>
                    <TableCell>{event.accion}</TableCell>
                    <TableCell>{event.tipo_objetivo} · {event.objetivo_id ?? "—"}</TableCell>
                    <TableCell>{event.resultado}</TableCell>
                    <TableCell>
                      <details>
                        <summary className="cursor-pointer text-primary">Ver</summary>
                        <div className="absolute right-8 z-10 mt-2 max-h-96 w-[min(42rem,calc(100vw-3rem))] overflow-auto rounded-lg border bg-background p-4 shadow-lg">
                          <p className="mb-2 text-sm">Recibido: <time dateTime={event.recibida_en}>{new Date(event.recibida_en).toLocaleString("es-AR")}</time></p>
                          {event.evento_dispositivo_en && <p className="mb-2 text-sm">Evento del dispositivo: <time dateTime={event.evento_dispositivo_en}>{new Date(event.evento_dispositivo_en).toLocaleString("es-AR")}</time></p>}
                          <p className="mb-2 text-sm">Correlación: {event.identidad_correlacion ?? "—"}</p>
                          <h3 className="mb-1 text-sm font-semibold">Resumen del cambio</h3>
                          <pre className="mb-3 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(event.resumen_cambio, null, 2)}</pre>
                          <h3 className="mb-1 text-sm font-semibold">Identificadores relacionados</h3>
                          <pre className="overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(event.identificadores_relacionados, null, 2)}</pre>
                        </div>
                      </details>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">{query.data.total} eventos · {query.data.offset + 1}–{query.data.offset + query.data.items.length}</p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={query.data.offset === 0} onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - PAGE_SIZE) }))}>Anterior</Button>
              <Button variant="outline" disabled={!query.data.has_more} onClick={() => setFilters((current) => ({ ...current, offset: (current.offset ?? 0) + PAGE_SIZE }))}>Siguiente</Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
