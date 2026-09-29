"use client"

import Link from "next/link"
import { useState } from "react"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEdgeAdminCertificates } from "@/lib/api/hooks"

export function CertificateHistory() {
  const [q, setQ] = useState("")
  const query = useEdgeAdminCertificates(q)
  return <div className="space-y-6"><PageHeader titulo="Certificados" descripcion="Historial completo de Certificados, incluidos pendientes y finalizados." acciones={<Input placeholder="Buscar por Válvula o Yacimiento" value={q} onChange={(event) => setQ(event.target.value)} className="w-72" />} />
    {query.isLoading && <div className="h-48 animate-pulse rounded-xl bg-muted" />}
    {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
    {query.data?.items.length === 0 && <EmptyState titulo="No hay certificados" descripcion="No se encontraron registros con los filtros actuales." />}
    {query.data && query.data.items.length > 0 && <div className="rounded-xl border"><Table><TableHeader><TableRow><TableHead>Estado</TableHead><TableHead>Válvula</TableHead><TableHead>Yacimiento</TableHead><TableHead>Creado</TableHead><TableHead /></TableRow></TableHeader><TableBody>{query.data.items.map((certificate) => <TableRow key={certificate.id}><TableCell>{String(certificate.estado ?? "—")}</TableCell><TableCell>{String(certificate.valvula_nombre ?? certificate.valvula_id ?? "—")}</TableCell><TableCell>{String(certificate.yacimiento_nombre ?? certificate.yacimiento_id ?? "—")}</TableCell><TableCell>{String(certificate.created_at ?? "—")}</TableCell><TableCell><Link className="text-primary underline" href={`/admin/certificados/${certificate.id}`}>Ver detalle</Link></TableCell></TableRow>)}</TableBody></Table></div>}
  </div>
}
