"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { useEdgeAdminMetrics } from "@/lib/api/hooks"
import { SyncConflictsPanel } from "@/components/admin/sync-conflicts-panel"

const ARGENTINA_TIME_ZONE = "America/Argentina/Buenos_Aires"

function argentinaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARGENTINA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  return Object.fromEntries(parts.map(({ type, value }) => [type, value])) as Record<string, string>
}

export function dashboardMonthBounds(now: Date = new Date()) {
  const { year, month } = argentinaDateParts(now)
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()
  return {
    from: `${year}-${month}-01`,
    to: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  }
}

function displayArgentinaDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: ARGENTINA_TIME_ZONE,
    dateStyle: "long",
  }).format(new Date(`${value}T12:00:00-03:00`))
}

export function AdminDashboard() {
  const [from, setFrom] = useState(() => dashboardMonthBounds().from)
  const [to, setTo] = useState(() => dashboardMonthBounds().to)
  const query = useEdgeAdminMetrics(from, to)
  const validPeriod = Boolean(from && to && from <= to)
  const cards = query.data ? [
    ["Certificados finalizados", query.data.finalized_certificates],
    ["Visitas completadas", query.data.completed_visits],
    ["Certificados pendientes", query.data.pending_certificates],
    ["Vencen en 30 días", query.data.expiring_certificates],
    ["Visitas sin Taller Móvil", query.data.unassigned_visits],
  ] as const : []
  return <div className="space-y-6"><PageHeader titulo="Panel" descripcion="Métricas operativas por fecha calendario de Argentina." acciones={<div className="flex gap-2"><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Desde" /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Hasta" /></div>} />
    {!validPeriod && <p className="text-sm text-destructive" role="alert">La fecha Desde debe ser anterior o igual a la fecha Hasta.</p>}
    {validPeriod && <p className="text-sm text-muted-foreground">Período: {displayArgentinaDate(from)} al {displayArgentinaDate(to)} (Argentina)</p>}
    {validPeriod && query.isLoading && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-label="Cargando métricas">{[1,2,3,4,5].map((item) => <Card key={item}><CardContent className="h-28 animate-pulse" /></Card>)}</div>}
    {validPeriod && query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
    {validPeriod && query.data && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{cards.map(([title, value]) => <Card key={title}><CardHeader><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader><CardContent><p className="text-3xl font-semibold">{value}</p></CardContent></Card>)}</div>}
    {validPeriod && query.data && cards.every(([, value]) => value === 0) && <EmptyState titulo="Sin actividad en el período" descripcion="Elegí otro período para consultar métricas operativas." />}
    <SyncConflictsPanel />
  </div>
}
