"use client"

import { ClipboardList, Plus, Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { PageHeader } from "@/components/common/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { edgeApi } from "@/lib/api"
import { useEdgeServiceRequests, useEdgeVisits } from "@/lib/api/hooks"
import { ESTADO_TAREA_LABEL } from "@/lib/domain/rules"
import type { EstadoTarea } from "@/lib/domain/types"
import { fmt, hoyIso } from "@/lib/fechas"
import { usaSupabase, useEmpresas, useOperaciones, useTalleres } from "@/lib/hooks/queries"
import type { FiltroTareas } from "@/lib/services"

import { EstadoTareaBadge, TallerChip } from "./badges"
import { convertirOperacionATarea } from "./tarea-sheet"

type Vista = "proximas" | "pasadas" | "todas"
const TODOS = "__todos"

/** Listado de tareas con filtros (RF-33). */
export function TareasList() {
  const router = useRouter()
  const [vista, setVista] = useState<Vista>("proximas")
  const [estado, setEstado] = useState<string>(TODOS)
  const [taller, setTaller] = useState<string>(TODOS)
  const [empresa, setEmpresa] = useState<string>(TODOS)
  const [busqueda, setBusqueda] = useState("")
  const q = useDebouncedValue(busqueda)

  const hoy = hoyIso()
  const filtro: FiltroTareas = {
    desde: vista === "proximas" ? hoy : undefined,
    hasta: vista === "pasadas" ? hoy : undefined,
    estados: estado === TODOS ? undefined : [estado as EstadoTarea],
    tallerId: taller === TODOS ? undefined : taller,
    empresaId: empresa === TODOS ? undefined : empresa,
    q: q || undefined,
  }
  const operaciones = useOperaciones(filtro)
  const requests = useEdgeServiceRequests(usaSupabase())
  const visits = useEdgeVisits(usaSupabase())
  const data = (operaciones.data ?? []).map(convertirOperacionATarea)
  const isPending = operaciones.isPending
  const isError = operaciones.isError
  const error = operaciones.error
  const refetch = operaciones.refetch
  const isPlaceholderData = operaciones.isPlaceholderData
  const talleres = useTalleres()
  const empresas = useEmpresas({ incluirInactivas: true })
  const visitRequestIds = new Set((visits.data ?? []).map(({ visit }) => String(visit.solicitud_id ?? "")))
  const requestsWithoutVisit = usaSupabase()
    ? (requests.data ?? []).filter(({ request }) => {
        const id = String(request.id ?? "")
        if (visitRequestIds.has(id)) return false
        if (vista === "pasadas" || (estado !== TODOS && estado !== "pendiente")) return false
        if (taller !== TODOS && taller !== "sin_asignar") return false
        if (empresa !== TODOS && request.cliente_cuenta_id !== empresa) return false
        return !q || String(request.numero_solicitud ?? "").includes(q) ||
          String(request.yacimiento_id ?? "").toLowerCase().includes(q.toLowerCase())
      })
    : []

  const filas = vista === "pasadas" ? [...(data ?? [])].reverse() : (data ?? [])
  const sinAsignar = filas.filter((t) => t.estado === "pendiente").length

  return (
    <>
      <PageHeader
        titulo="Tareas"
        descripcion="Solicitudes de servicio cargadas por administración, con su taller asignado."
        acciones={
          <Button asChild>
            <Link href="/admin/tareas/nueva">
              <Plus />
              Nueva tarea
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={vista} onValueChange={(v) => setVista(v as Vista)}>
          <TabsList>
            <TabsTrigger value="proximas">Próximas</TabsTrigger>
            <TabsTrigger value="pasadas">Pasadas</TabsTrigger>
            <TabsTrigger value="todas">Todas</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="N° de solicitud, locación…"
            className="pl-8"
            aria-label="Buscar tareas"
          />
        </div>
        <Select value={estado} onValueChange={setEstado}>
          <SelectTrigger className="w-40" aria-label="Estado">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los estados</SelectItem>
            {(Object.keys(ESTADO_TAREA_LABEL) as EstadoTarea[]).map((e) => (
              <SelectItem key={e} value={e}>
                {ESTADO_TAREA_LABEL[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={taller} onValueChange={setTaller}>
          <SelectTrigger className="w-44" aria-label="Taller">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los talleres</SelectItem>
            <SelectItem value="sin_asignar">Sin asignar</SelectItem>
            {talleres.data?.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={empresa} onValueChange={setEmpresa}>
          <SelectTrigger className="w-56" aria-label="Cliente">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos los clientes</SelectItem>
            {empresas.data?.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.razonSocial}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data && (
        <p className="-mt-2 text-sm text-muted-foreground">
          {filas.length} {filas.length === 1 ? "tarea" : "tareas"}
          {sinAsignar > 0 && taller === TODOS && (
            <>
              {" · "}
              <button
                type="button"
                className="font-medium text-amber-700 hover:underline"
                onClick={() => setTaller("sin_asignar")}
              >
                {sinAsignar} sin asignar
              </button>
            </>
          )}
        </p>
      )}

      {!requests.isPending && !visits.isPending && requestsWithoutVisit.length > 0 && (
        <section className="space-y-2" aria-label="Solicitudes sin visita">
          <h2 className="font-medium">Solicitudes de servicio sin visita programada</h2>
          <ul className="space-y-2">
            {requestsWithoutVisit.map(({ request, selected_valves }) => (
              <SolicitudSinVisita
                key={String(request.id)}
                requestId={String(request.id)}
                numero={String(request.numero_solicitud ?? "—")}
                yacimientoId={String(request.yacimiento_id ?? "—")}
                valvulas={selected_valves.length}
                talleres={(talleres.data ?? []).filter((item) => item.activo).map((item) => ({ id: item.id, nombre: item.nombre }))}
                onScheduled={() => { void refetch(); void requests.refetch(); void visits.refetch() }}
              />
            ))}
          </ul>
        </section>
      )}

      {isError || requests.isError || visits.isError ? (
        <ErrorState error={error ?? requests.error ?? visits.error} onRetry={() => { void refetch(); void requests.refetch(); void visits.refetch() }} />
      ) : isPending || (usaSupabase() && (requests.isPending || visits.isPending)) ? (
        <Skeleton className="h-80 w-full" />
      ) : filas.length === 0 && requestsWithoutVisit.length === 0 ? (
        <EmptyState
          icono={ClipboardList}
          titulo="No hay tareas con estos filtros"
          descripcion="Probá con otra vista o quitá algún filtro."
        />
      ) : filas.length > 0 ? (
        <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <div className="overflow-hidden rounded-xl border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-20">N°</TableHead>
                  <TableHead>Ejecución</TableHead>
                  <TableHead>Cliente y locación</TableHead>
                  <TableHead className="hidden lg:table-cell">Tipo</TableHead>
                  <TableHead className="hidden md:table-cell">Taller</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/admin/tareas/${t.id}`)}
                  >
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/admin/tareas/${t.id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t.nroSolicitud}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="capitalize">{fmt(t.fechaEjecucion, "EEE dd/MM/yy")}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.horario ? `${t.horario} h` : "Sin horario"}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-72">
                      <div className="truncate font-medium">{t.empresaNombre}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {t.plantaNombre} · {t.yacimientoNombre} · {t.equipoNombre}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">{t.tipo}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <TallerChip nombre={t.tallerNombre} color={t.tallerColor} />
                    </TableCell>
                    <TableCell>
                      <EstadoTareaBadge estado={t.estado} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}
    </>
  )
}

function SolicitudSinVisita({ requestId, numero, yacimientoId, valvulas, talleres, onScheduled }: {
  requestId: string
  numero: string
  yacimientoId: string
  valvulas: number
  talleres: { id: string; nombre: string }[]
  onScheduled: () => void
}) {
  const [fecha, setFecha] = useState("")
  const [hora, setHora] = useState("08:00")
  const [tallerId, setTallerId] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const schedule = async () => {
    setBusy(true)
    setError("")
    try {
      const startsAt = new Date(`${fecha}T${hora}:00-03:00`)
      if (Number.isNaN(startsAt.getTime())) throw new Error("Elegí fecha y hora válidas")
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000)
      await edgeApi.serviceWorkflow.schedule(requestId, {
        tallerMovilId: tallerId,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })
      onScheduled()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo programar la visita")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 rounded-lg border p-3 text-sm">
      <p>Solicitud N° {numero} · Yacimiento {yacimientoId} <span className="text-muted-foreground">· Sin visita · {valvulas} válvulas seleccionadas</span></p>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label={`Fecha de visita para solicitud ${numero}`} value={fecha} onChange={(event) => setFecha(event.target.value)} className="w-40" />
        <Input type="time" aria-label={`Hora de visita para solicitud ${numero}`} value={hora} onChange={(event) => setHora(event.target.value)} className="w-32" />
        <Select value={tallerId} onValueChange={setTallerId}>
          <SelectTrigger className="w-48" aria-label={`Taller para solicitud ${numero}`}><SelectValue placeholder="Elegir Taller Móvil" /></SelectTrigger>
          <SelectContent>{talleres.map((item) => <SelectItem key={item.id} value={item.id}>{item.nombre}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" disabled={busy || !fecha || !tallerId} onClick={() => void schedule()}>{busy ? "Programando…" : "Programar visita"}</Button>
      </div>
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </li>
  )
}
