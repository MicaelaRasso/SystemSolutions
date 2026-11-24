"use client"

import Link from "next/link"
import { useState } from "react"
import { BarraFiltros, CampoFiltro } from "@/components/common/barra-filtros"
import { PageHeader } from "@/components/common/page-header"
import { SelectNativo } from "@/components/common/select-nativo"
import { EmptyState, ErrorState } from "@/components/common/states"
import { TablaResponsive } from "@/components/common/tabla-responsive"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEdgeAdminCertificates } from "@/lib/api/hooks"
import type { AdminCertificateFilters } from "@/lib/api/observability"
import { fmtFechaHora } from "@/lib/format"

const PAGE_SIZE = 50
const initialFilters: AdminCertificateFilters = { limit: PAGE_SIZE, offset: 0 }

/** Fecha de creación legible (dd/MM/yyyy HH:mm, hora local); nunca el ISO crudo (D13). */
function fechaCreacion(value: unknown): string {
  if (typeof value !== "string" || !value) return "—"
  const fecha = new Date(value)
  return Number.isNaN(fecha.getTime()) ? "—" : fmtFechaHora(value)
}

function resolveCertificatePd(certificate: Record<string, unknown>): string {
  const direct = certificate.pd ?? certificate.parte_diario ?? certificate.parte_diario_codigo
  if (typeof direct === "string" && direct.trim()) return direct.trim()
  const custom =
    certificate.campos_personalizados &&
    typeof certificate.campos_personalizados === "object" &&
    !Array.isArray(certificate.campos_personalizados)
      ? (certificate.campos_personalizados as Record<string, unknown>)
      : {}
  const fromCustom = custom.pd_rto ?? custom.pd ?? custom.parte_diario
  if (typeof fromCustom === "string" && fromCustom.trim()) return fromCustom.trim()
  return "—"
}

export function CertificateHistory() {
  const [draft, setDraft] = useState<AdminCertificateFilters>({})
  const [filters, setFilters] = useState<AdminCertificateFilters>(initialFilters)
  const query = useEdgeAdminCertificates(filters)

  const set = <Key extends keyof AdminCertificateFilters>(
    key: Key,
    value: AdminCertificateFilters[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value || undefined }))
  }


  const pdTerm = filters.pd_code?.trim().toLowerCase()
  const visibleItems = (query.data?.items ?? []).filter((item) => {
    if (!pdTerm) return true
    const pdValue = resolveCertificatePd(item as Record<string, unknown>).toLowerCase()
    return pdValue !== "—" && pdValue.includes(pdTerm)
  })

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Certificados"
        descripcion="Historial completo de Certificados, incluidos pendientes y finalizados."
      />
      <section
        aria-label="Filtros del historial de certificados"
        className="space-y-4 rounded-xl border p-4"
      >
        <BarraFiltros
          activos={Object.values(draft).filter(Boolean).length}
          columnas="sm:grid-cols-2 lg:grid-cols-4"
        >
          <CampoFiltro etiqueta="Cliente (ID de Cuenta)" htmlFor="cert-cliente">
            <Input
              id="cert-cliente"
              value={draft.client_id ?? ""}
              onChange={(event) => set("client_id", event.target.value.trim())}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Yacimiento (ID)" htmlFor="cert-yacimiento">
            <Input
              id="cert-yacimiento"
              value={draft.yacimiento_id ?? ""}
              onChange={(event) => set("yacimiento_id", event.target.value.trim())}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Planta/locación (ID)" htmlFor="cert-planta">
            <Input
              id="cert-planta"
              value={draft.plant_id ?? ""}
              onChange={(event) => set("plant_id", event.target.value.trim())}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Válvula (ID)" htmlFor="cert-valvula">
            <Input
              id="cert-valvula"
              value={draft.valve_id ?? ""}
              onChange={(event) => set("valve_id", event.target.value.trim())}
              placeholder="UUID"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Parte Diario (PD)" htmlFor="cert-pd">
            <Input
              id="cert-pd"
              value={draft.pd_code ?? ""}
              onChange={(event) => set("pd_code", event.target.value.trim())}
              placeholder="Ej. PD1234"
            />
          </CampoFiltro>
          <CampoFiltro etiqueta="Estado del Certificado" htmlFor="cert-estado">
            <SelectNativo
              id="cert-estado"
              value={draft.state ?? ""}
              onChange={(event) =>
                set("state", (event.target.value || undefined) as AdminCertificateFilters["state"])
              }
            >
              <option value="">Todos</option>
              <option value="borrador">Borrador</option>
              <option value="pendiente">Pendiente</option>
              <option value="finalizado">Finalizado</option>
            </SelectNativo>
          </CampoFiltro>
          <CampoFiltro etiqueta="Estado de firma" htmlFor="cert-firma">
            <SelectNativo
              id="cert-firma"
              value={draft.signature_state ?? ""}
              onChange={(event) =>
                set(
                  "signature_state",
                  (event.target.value || undefined) as AdminCertificateFilters["signature_state"],
                )
              }
            >
              <option value="">Todos</option>
              <option value="none">Sin firmas</option>
              <option value="partial">Una firma</option>
              <option value="complete">Ambas firmas</option>
            </SelectNativo>
          </CampoFiltro>
          <CampoFiltro etiqueta="Vigencia del certificado hasta" htmlFor="cert-vigencia">
            <Input
              id="cert-vigencia"
              type="date"
              value={draft.valid_until ?? ""}
              onChange={(event) => set("valid_until", event.target.value)}
            />
          </CampoFiltro>
          <CampoFiltro
            etiqueta="Buscar por Cliente, Yacimiento, Planta/locación o Válvula"
            htmlFor="cert-busqueda"
          >
            <Input
              id="cert-busqueda"
              value={draft.q ?? ""}
              onChange={(event) => set("q", event.target.value.trim())}
            />
          </CampoFiltro>
        </BarraFiltros>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button onClick={() => setFilters({ ...draft, limit: PAGE_SIZE, offset: 0 })}>
            Aplicar filtros
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setDraft({})
              setFilters(initialFilters)
            }}
          >
            Limpiar filtros
          </Button>
        </div>
      </section>

      {query.isLoading && <div className="h-48 animate-pulse rounded-xl bg-muted" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && visibleItems.length === 0 && (
        <EmptyState
          titulo="No hay certificados"
          descripcion="No se encontraron registros con los filtros actuales."
        />
      )}
      {query.data && visibleItems.length > 0 && (
        <>
          <TablaResponsive
            filas={visibleItems}
            clave={(certificate) => certificate.id}
            desde="lg"
            descripcion="Historial de certificados"
            columnas={[
              {
                id: "estado",
                encabezado: "Estado",
                celda: (certificate) => String(certificate.estado ?? "—"),
              },
              {
                id: "pd",
                encabezado: "Parte Diario",
                celda: (certificate) => (
                  <span className="font-mono text-xs">
                    {resolveCertificatePd(certificate as Record<string, unknown>)}
                  </span>
                ),
              },
              {
                id: "firmas",
                encabezado: "Firmas",
                celda: (certificate) =>
                  certificate.signature_state === "complete"
                    ? "Ambas"
                    : certificate.signature_state === "partial"
                      ? "Una"
                      : "Ninguna",
              },
              {
                id: "cliente",
                encabezado: "Cliente",
                celda: (certificate) =>
                  String(certificate.cliente_email ?? "—"),
              },
              {
                id: "valvula",
                encabezado: "Válvula",
                celda: (certificate) =>
                  String(certificate.valvula_nombre ?? "—"),
              },
              {
                id: "yacimiento",
                encabezado: "Yacimiento",
                celda: (certificate) =>
                  String(certificate.yacimiento_nombre ?? "—"),
              },
              {
                id: "planta",
                encabezado: "Planta/locación",
                celda: (certificate) =>
                  String(certificate.planta_nombre ?? "—"),
              },
              {
                id: "creado",
                encabezado: "Creado",
                celda: (certificate) => fechaCreacion(certificate.created_at),
              },
            ]}
            acciones={(certificate) => (
              <div className="flex gap-3 whitespace-nowrap">
                <Link
                  className="inline-flex items-center text-primary underline pointer-coarse:min-h-11"
                  href={`/admin/certificados/${certificate.id}`}
                >
                  Ver detalle
                </Link>
                <Link
                  className="inline-flex items-center text-primary underline pointer-coarse:min-h-11"
                  href={`/admin/certificados/${certificate.id}?descargar=1`}
                >
                  Descargar PDF
                </Link>
              </div>
            )}
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              Mostrando {(filters.offset ?? 0) + 1}–
              {Math.min(
                (filters.offset ?? 0) + visibleItems.length,
                query.data.total,
              )}{" "}
              de {query.data.total}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={(filters.offset ?? 0) === 0}
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
                disabled={(filters.offset ?? 0) + PAGE_SIZE >= query.data.total}
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
