"use client"

import { useState } from "react"
import { BarraFiltros, CampoFiltro } from "@/components/common/barra-filtros"
import { PageHeader } from "@/components/common/page-header"
import { SelectNativo } from "@/components/common/select-nativo"
import { EmptyState, ErrorState } from "@/components/common/states"
import { FilaTarjeta, TablaResponsive } from "@/components/common/tabla-responsive"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AuditEventDto as AuditEvent, AuditFilters } from "@/lib/api/observability"
import { useEdgeAuditEvents } from "@/lib/api/hooks"
import { edgeApi } from "@/lib/api"
import { useAuth } from "@/lib/auth/auth-provider"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 50

const fieldClassName = "w-full"

const fechaHora = (iso: string) => new Date(iso).toLocaleString("es-AR")

/** Detalle del evento: panel flotante en la tabla, bloque en línea en la tarjeta del celular. */
function DetalleEvento({ event, enLinea }: { event: AuditEvent; enLinea?: boolean }) {
  return (
    <details className={cn(enLinea && "w-full")}>
      <summary className="cursor-pointer text-primary pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
        Ver
      </summary>
      <div
        className={cn(
          "overflow-auto rounded-lg border bg-background p-4",
          enLinea
            ? "mt-2 max-h-96"
            : "absolute right-8 z-10 mt-2 max-h-96 w-[min(42rem,calc(100vw-3rem))] shadow-lg",
        )}
      >
        <p className="mb-2 text-sm">
          Recibido: <time dateTime={event.recibida_en}>{fechaHora(event.recibida_en)}</time>
        </p>
        {event.evento_dispositivo_en && (
          <p className="mb-2 text-sm">
            Evento del dispositivo:{" "}
            <time dateTime={event.evento_dispositivo_en}>
              {fechaHora(event.evento_dispositivo_en)}
            </time>
          </p>
        )}
        <p className="mb-2 text-sm break-all">Correlación: {event.identidad_correlacion ?? "—"}</p>
        <h3 className="mb-1 text-sm font-semibold">Resumen del cambio</h3>
        <pre className="mb-3 overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(event.resumen_cambio, null, 2)}
        </pre>
        <h3 className="mb-1 text-sm font-semibold">Identificadores relacionados</h3>
        <pre className="overflow-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(event.identificadores_relacionados, null, 2)}
        </pre>
      </div>
    </details>
  )
}

export function AuditLog() {
  const { sesion } = useAuth()
  const [draftFilters, setDraftFilters] = useState<AuditFilters>({})
  const [filters, setFilters] = useState<AuditFilters>({ limit: PAGE_SIZE, offset: 0 })
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const query = useEdgeAuditEvents(filters)
  const updateFilter = <Key extends keyof AuditFilters>(key: Key, value: AuditFilters[Key]) => {
    setDraftFilters((current) => ({ ...current, [key]: value || undefined }))
  }
  const filtrosCargados = Object.values(draftFilters).filter(Boolean).length
  const exportAudit = async (format: "json" | "csv") => {
    setExporting(format)
    setExportError(null)
    try {
      const response = await edgeApi.observability.audit.export(filters, format)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = url
      link.download = format === "json" ? "auditoria.json" : "auditoria.csv"
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "No se pudo exportar la auditoría")
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Registro de auditoría"
        descripcion="Actividad administrativa ordenada por recepción del servidor."
      />

      <section aria-label="Filtros de auditoría" className="space-y-4 rounded-xl border p-4">
        <BarraFiltros activos={filtrosCargados} columnas="sm:grid-cols-2 lg:grid-cols-4">
          <CampoFiltro etiqueta="Desde" htmlFor="auditoria-desde">
            <Input
              id="auditoria-desde"
              type="date"
              value={draftFilters.from ?? ""}
              onChange={(event) => updateFilter("from", event.target.value)}
              className={fieldClassName}
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Hasta" htmlFor="auditoria-hasta">
            <Input
              id="auditoria-hasta"
              type="date"
              value={draftFilters.to ?? ""}
              onChange={(event) => updateFilter("to", event.target.value)}
              className={fieldClassName}
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Actor (ID de cuenta)" htmlFor="auditoria-actor">
            <Input
              id="auditoria-actor"
              value={draftFilters.actorId ?? ""}
              onChange={(event) => updateFilter("actorId", event.target.value.trim())}
              className={fieldClassName}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Acción" htmlFor="auditoria-accion">
            <Input
              id="auditoria-accion"
              value={draftFilters.action ?? ""}
              onChange={(event) => updateFilter("action", event.target.value.trim())}
              className={fieldClassName}
              placeholder="visita_completada"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Tipo de objetivo" htmlFor="auditoria-objetivo">
            <Input
              id="auditoria-objetivo"
              value={draftFilters.targetType ?? ""}
              onChange={(event) => updateFilter("targetType", event.target.value.trim())}
              className={fieldClassName}
              placeholder="visita_servicio"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Resultado" htmlFor="auditoria-resultado">
            <SelectNativo
              id="auditoria-resultado"
              value={draftFilters.outcome ?? ""}
              onChange={(event) =>
                updateFilter(
                  "outcome",
                  (event.target.value || undefined) as AuditFilters["outcome"],
                )
              }
            >
              <option value="">Todos</option>
              <option value="exitoso">Exitoso</option>
              <option value="fallido">Fallido</option>
            </SelectNativo>
          </CampoFiltro>
          <CampoFiltro etiqueta="Cliente (ID de cuenta)" htmlFor="auditoria-cliente">
            <Input
              id="auditoria-cliente"
              value={draftFilters.clientId ?? ""}
              onChange={(event) => updateFilter("clientId", event.target.value.trim())}
              className={fieldClassName}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Yacimiento (ID)" htmlFor="auditoria-yacimiento">
            <Input
              id="auditoria-yacimiento"
              value={draftFilters.yacimientoId ?? ""}
              onChange={(event) => updateFilter("yacimientoId", event.target.value.trim())}
              className={fieldClassName}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Visita de servicio (ID)" htmlFor="auditoria-visita">
            <Input
              id="auditoria-visita"
              value={draftFilters.visitId ?? ""}
              onChange={(event) => updateFilter("visitId", event.target.value.trim())}
              className={fieldClassName}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Certificado (ID)" htmlFor="auditoria-certificado">
            <Input
              id="auditoria-certificado"
              value={draftFilters.certificateId ?? ""}
              onChange={(event) => updateFilter("certificateId", event.target.value.trim())}
              className={fieldClassName}
              placeholder="UUID"
            />
          </CampoFiltro>
        </BarraFiltros>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button onClick={() => setFilters({ ...draftFilters, limit: PAGE_SIZE, offset: 0 })}>
            Aplicar filtros
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDraftFilters({})
              setFilters({ limit: PAGE_SIZE, offset: 0 })
            }}
          >
            Limpiar filtros
          </Button>
          {sesion?.rol === "superadmin" && (
            <>
              <Button
                variant="outline"
                disabled={exporting !== null}
                onClick={() => void exportAudit("json")}
              >
                {exporting === "json" ? "Exportando JSON…" : "Exportar JSON"}
              </Button>
              <Button
                variant="outline"
                disabled={exporting !== null}
                onClick={() => void exportAudit("csv")}
              >
                {exporting === "csv" ? "Exportando CSV…" : "Exportar CSV"}
              </Button>
            </>
          )}
        </div>
      </section>

      {exportError && (
        <p role="alert" className="text-sm text-destructive">
          {exportError}
        </p>
      )}

      {query.isLoading && <div className="h-48 animate-pulse rounded-xl bg-muted" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && (
        <EmptyState
          titulo="Sin eventos"
          descripcion="Las lecturas ordinarias no generan eventos de auditoría."
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <>
          <TablaResponsive
            filas={query.data.items}
            clave={(event) => event.id}
            desde="lg"
            descripcion="Eventos de auditoría"
            columnas={[
              {
                id: "recepcion",
                encabezado: "Recepción del servidor",
                celda: (event) => (
                  <>
                    <time dateTime={event.recibida_en}>{fechaHora(event.recibida_en)}</time>
                    {event.evento_dispositivo_en && (
                      <div className="text-xs text-muted-foreground">
                        Evento en dispositivo:{" "}
                        <time dateTime={event.evento_dispositivo_en}>
                          {fechaHora(event.evento_dispositivo_en)}
                        </time>
                      </div>
                    )}
                  </>
                ),
              },
              {
                id: "actor",
                encabezado: "Actor",
                celda: (event) => (
                  <>
                    {event.actor_email || event.actor_cuenta_id || "Sistema"}
                    {event.actor_rol && (
                      <div className="text-xs text-muted-foreground">{event.actor_rol}</div>
                    )}
                  </>
                ),
              },
              { id: "accion", encabezado: "Acción", celda: (event) => event.accion },
              {
                id: "objetivo",
                encabezado: "Objetivo",
                celda: (event) => (
                  <>
                    {event.tipo_objetivo} · {event.objetivo_id ?? "—"}
                  </>
                ),
              },
              { id: "resultado", encabezado: "Resultado", celda: (event) => event.resultado },
              {
                id: "detalle",
                encabezado: <span className="sr-only">Detalle</span>,
                celda: (event) => <DetalleEvento event={event} />,
              },
            ]}
            tarjeta={(event) => (
              <FilaTarjeta
                titulo={
                  <div className="flex items-start justify-between gap-2">
                    <span className="break-all">{event.accion}</span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {event.resultado}
                    </span>
                  </div>
                }
                campos={[
                  {
                    etiqueta: "Recibido",
                    valor: <time dateTime={event.recibida_en}>{fechaHora(event.recibida_en)}</time>,
                  },
                  {
                    etiqueta: "Actor",
                    valor: (
                      <span className="break-all">
                        {event.actor_email || event.actor_cuenta_id || "Sistema"}
                        {event.actor_rol ? ` · ${event.actor_rol}` : ""}
                      </span>
                    ),
                  },
                  {
                    etiqueta: "Objetivo",
                    valor: (
                      <span className="break-all">
                        {event.tipo_objetivo} · {event.objetivo_id ?? "—"}
                      </span>
                    ),
                  },
                ]}
                acciones={<DetalleEvento event={event} enLinea />}
              />
            )}
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {query.data.total} eventos · {query.data.offset + 1}–
              {query.data.offset + query.data.items.length}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={query.data.offset === 0}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    offset: Math.max(0, (current.offset ?? 0) - PAGE_SIZE),
                  }))
                }
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={!query.data.has_more}
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    offset: (current.offset ?? 0) + PAGE_SIZE,
                  }))
                }
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
