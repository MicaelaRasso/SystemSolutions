"use client"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEdgeAdminCertificates } from "@/lib/api/hooks"
import { edgeApi } from "@/lib/api"
import type { AdminCertificateFilters } from "@/lib/api/observability"

const PAGE_SIZE = 50
const initialFilters: AdminCertificateFilters = { limit: PAGE_SIZE, offset: 0 }
const fieldClassName = "space-y-1 text-sm font-medium"

export function CertificateHistory() {
  const [draft, setDraft] = useState<AdminCertificateFilters>({})
  const [filters, setFilters] = useState<AdminCertificateFilters>(initialFilters)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const query = useEdgeAdminCertificates(filters)

  const set = <Key extends keyof AdminCertificateFilters>(key: Key, value: AdminCertificateFilters[Key]) => {
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
      setDownloadError(error instanceof Error ? error.message : "No se pudo descargar el Certificado")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader titulo="Certificados" descripcion="Historial completo de Certificados, incluidos pendientes y finalizados." />
      <section aria-label="Filtros del historial de certificados" className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className={fieldClassName}>
          Cliente (ID de Cuenta)
          <Input value={draft.client_id ?? ""} onChange={(event) => set("client_id", event.target.value.trim())} placeholder="UUID" />
        </label>
        <label className={fieldClassName}>
          Yacimiento (ID)
          <Input value={draft.yacimiento_id ?? ""} onChange={(event) => set("yacimiento_id", event.target.value.trim())} placeholder="UUID" />
        </label>
        <label className={fieldClassName}>
          Planta/locación (ID)
          <Input value={draft.plant_id ?? ""} onChange={(event) => set("plant_id", event.target.value.trim())} placeholder="UUID" />
        </label>
        <label className={fieldClassName}>
          Válvula (ID)
          <Input value={draft.valve_id ?? ""} onChange={(event) => set("valve_id", event.target.value.trim())} placeholder="UUID" />
        </label>
        <label className={fieldClassName}>
          Estado del Certificado
          <select value={draft.state ?? ""} onChange={(event) => set("state", (event.target.value || undefined) as AdminCertificateFilters["state"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">Todos</option><option value="borrador">Borrador</option><option value="pendiente">Pendiente</option><option value="finalizado">Finalizado</option>
          </select>
        </label>
        <label className={fieldClassName}>
          Estado de firma
          <select value={draft.signature_state ?? ""} onChange={(event) => set("signature_state", (event.target.value || undefined) as AdminCertificateFilters["signature_state"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">Todos</option><option value="none">Sin firmas</option><option value="partial">Una firma</option><option value="complete">Ambas firmas</option>
          </select>
        </label>
        <label className={fieldClassName}>
          Vigencia del certificado hasta
          <Input type="date" value={draft.valid_until ?? ""} onChange={(event) => set("valid_until", event.target.value)} />
        </label>
        <label className={fieldClassName}>
          Buscar por Cliente, Yacimiento, Planta/locación o Válvula
          <Input value={draft.q ?? ""} onChange={(event) => set("q", event.target.value.trim())} />
        </label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
          <Button onClick={() => setFilters({ ...draft, limit: PAGE_SIZE, offset: 0 })}>Aplicar filtros</Button>
          <Button variant="outline" onClick={() => { setDraft({}); setFilters(initialFilters) }}>Limpiar filtros</Button>
        </div>
      </section>

      {query.isLoading && <div className="h-48 animate-pulse rounded-xl bg-muted" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
      {query.data?.items.length === 0 && <EmptyState titulo="No hay certificados" descripcion="No se encontraron registros con los filtros actuales." />}
      {query.data && query.data.items.length > 0 && <>
        <div className="rounded-xl border"><Table>
          <TableHeader><TableRow><TableHead>Estado</TableHead><TableHead>Firmas</TableHead><TableHead>Cliente</TableHead><TableHead>Válvula</TableHead><TableHead>Yacimiento</TableHead><TableHead>Planta/locación</TableHead><TableHead>Creado</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{query.data.items.map((certificate) => <TableRow key={certificate.id}>
            <TableCell>{String(certificate.estado ?? "—")}</TableCell>
            <TableCell>{certificate.signature_state === "complete" ? "Ambas" : certificate.signature_state === "partial" ? "Una" : "Ninguna"}</TableCell>
            <TableCell>{String(certificate.cliente_email ?? certificate.cliente_cuenta_id ?? "—")}</TableCell>
            <TableCell>{String(certificate.valvula_nombre ?? certificate.valvula_id ?? "—")}</TableCell>
            <TableCell>{String(certificate.yacimiento_nombre ?? certificate.yacimiento_id ?? "—")}</TableCell>
            <TableCell>{String(certificate.planta_nombre ?? certificate.planta_id ?? "—")}</TableCell>
            <TableCell>{String(certificate.created_at ?? "—")}</TableCell>
            <TableCell><div className="flex gap-3 whitespace-nowrap"><Link className="text-primary underline" href={`/admin/certificados/${certificate.id}`}>Ver detalle</Link><button type="button" className="text-primary underline" onClick={() => void download(certificate.id, String(certificate.numero ?? certificate.id))}>Descargar</button></div></TableCell>
          </TableRow>)}</TableBody>
        </Table></div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">{query.data.total} certificados · {query.data.offset + 1}–{query.data.offset + query.data.items.length}</p>
          <div className="flex gap-2">
            <Button variant="outline" disabled={query.data.offset === 0} onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - PAGE_SIZE) }))}>Anterior</Button>
            <Button variant="outline" disabled={query.data.offset + query.data.items.length >= query.data.total} onClick={() => setFilters((current) => ({ ...current, offset: (current.offset ?? 0) + PAGE_SIZE }))}>Siguiente</Button>
          </div>
        </div>
      </>}
    </div>
  )
}
