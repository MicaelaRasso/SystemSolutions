"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { useEdgeAdminMetrics } from "@/lib/api/hooks"

const monthBounds = () => { const now = new Date(); const from = new Date(now.getFullYear(), now.getMonth(), 1); const to = new Date(now.getFullYear(), now.getMonth() + 1, 0); return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) } }

export function AdminDashboard() {
  const [from, setFrom] = useState(() => monthBounds().from)
  const [to, setTo] = useState(() => monthBounds().to)
  const query = useEdgeAdminMetrics(from, to)
  const cards = query.data ? [
    ["Certificados finalizados", query.data.finalized_certificates],
    ["Visitas completadas", query.data.completed_visits],
    ["Certificados pendientes", query.data.pending_certificates],
    ["Vencen en 30 días", query.data.expiring_certificates],
    ["Visitas sin Taller Móvil", query.data.unassigned_visits],
  ] as const : []
  return <div className="space-y-6"><PageHeader titulo="Panel" descripcion="Métricas operativas en hora de Argentina." acciones={<div className="flex gap-2"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Desde" /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Hasta" /></div>} />
    {query.isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{[1,2,3,4,5].map((item) => <Card key={item}><CardContent className="h-28 animate-pulse" /></Card>)}</div>}
    {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
    {query.data && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([title, value]) => <Card key={title}><CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{value}</p></CardContent></Card>)}</div>}
    {query.data && cards.every(([, value]) => value === 0) && <EmptyState titulo="Sin actividad en el período" descripcion="Elegí otro período para consultar métricas operativas." />}
  </div>
}
