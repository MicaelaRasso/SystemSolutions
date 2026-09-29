"use client"

import { useState } from "react"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useEdgeAuditEvents } from "@/lib/api/hooks"

export function AuditLog() {
  const [q, setQ] = useState("")
  const query = useEdgeAuditEvents(q)
  return <div className="space-y-6"><PageHeader titulo="Registro de auditoría" descripcion="Actividad administrativa ordenada por recepción del servidor." acciones={<Input placeholder="Filtrar acción" value={q} onChange={(event) => setQ(event.target.value)} className="w-64" />} />
    {query.isLoading && <div className="h-48 animate-pulse rounded-xl bg-muted" />}
    {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
    {query.data?.items.length === 0 && <EmptyState titulo="Sin eventos" descripcion="Las lecturas ordinarias no generan eventos de auditoría." />}
    {query.data && query.data.items.length > 0 && <div className="rounded-xl border"><Table><TableHeader><TableRow><TableHead>Recepción</TableHead><TableHead>Actor</TableHead><TableHead>Acción</TableHead><TableHead>Objetivo</TableHead><TableHead>Resultado</TableHead></TableRow></TableHeader><TableBody>{query.data.items.map((event) => <TableRow key={event.id}><TableCell>{new Date(event.recibida_en).toLocaleString("es-AR")}</TableCell><TableCell>{event.actor_email ?? event.actor_cuenta_id ?? "Sistema"}</TableCell><TableCell>{event.accion}</TableCell><TableCell>{event.tipo_objetivo} · {event.objetivo_id ?? "—"}</TableCell><TableCell>{event.resultado}</TableCell></TableRow>)}</TableBody></Table></div>}
  </div>
}
