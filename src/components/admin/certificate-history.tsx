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
import { edgeApi } from "@/lib/api"
import type { AdminCertificateFilters } from "@/lib/api/observability"

const PAGE_SIZE = 50
const initialFilters: AdminCertificateFilters = { limit: PAGE_SIZE, offset: 0 }

export function CertificateHistory() {
  const [draft, setDraft] = useState<AdminCertificateFilters>({})
  const [filters, setFilters] = useState<AdminCertificateFilters>(initialFilters)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const query = useEdgeAdminCertificates(filters)

  const set = <Key extends keyof AdminCertificateFilters>(
    key: Key,
    value: AdminCertificateFilters[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value || undefined }))
  }

  const download = async (id: string, label: string) => {
    setDownloadError(null)
    try {
      const response = await edgeApi.observability.certificates.download(id)
      if (!response.ok) throw new Error("No se pudo descargar el Certificado")
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = href
      anchor.download = `certificado-${label}.json`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "No se pudo descargar el Certificado",
      )
    }
  }

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
      {downloadError && (
        <p role="alert" className="text-sm text-destructive">
          {downloadError}
        </p>
      )}
      {query.data?.items.length === 0 && (
        <EmptyState
          titulo="No hay certificados"
          descripcion="No se encontraron registros con los filtros actuales."
        />
      )}
      {query.data && query.data.items.length > 0 && (
        <>
          <TablaResponsive
            filas={query.data.items}
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
                  String(certificate.cliente_email ?? certificate.cliente_cuenta_id ?? "—"),
              },
              {
                id: "valvula",
                encabezado: "Válvula",
                celda: (certificate) =>
                  String(certificate.valvula_nombre ?? certificate.valvula_id ?? "—"),
              },
              {
                id: "yacimiento",
                encabezado: "Yacimiento",
                celda: (certificate) =>
                  String(certificate.yacimiento_nombre ?? certificate.yacimiento_id ?? "—"),
              },
              {
                id: "planta",
                encabezado: "Planta/locación",
                celda: (certificate) =>
                  String(certificate.planta_nombre ?? certificate.planta_id ?? "—"),
              },
              {
                id: "creado",
                encabezado: "Creado",
                celda: (certificate) => String(certificate.created_at ?? "—"),
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
                <button
                  type="button"
                  className="text-primary underline pointer-coarse:min-h-11"
                  onClick={() =>
                    void download(certificate.id, String(certificate.numero ?? certificate.id))
                  }
                >
                  Descargar
                </button>
              </div>
            )}
          />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              {query.data.total} certificados · {query.data.offset + 1}–
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
                disabled={query.data.offset + query.data.items.length >= query.data.total}
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
