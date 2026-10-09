"use client"

import { CalendarCheck2, History, SearchX } from "lucide-react"
import { useState } from "react"

import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { fmt } from "@/lib/fechas"

import { useVisitasCliente } from "./use-visitas-cliente"
import { EstadoVisitaBadge, VisitaTarjeta } from "./visita-cliente-item"
import { filtrarVisitas, separarTurnos, type VisitaCliente } from "./visitas-cliente"

const TODOS = "todos"

/**
 * Turnos del Cliente (RF-35): pendientes e histórico de las visitas de su alcance, con
 * filtros por Yacimiento, planta/locación y fechas. Solo lectura: el Cliente no solicita
 * turnos (RF-36).
 */
export function TurnosCliente() {
  const { visitas, arboles, cargando, error, reintentar } = useVisitasCliente()
  const [yacimientoId, setYacimientoId] = useState(TODOS)
  const [plantaId, setPlantaId] = useState(TODOS)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  const plantas =
    yacimientoId === TODOS ? [] : (arboles.find((a) => a.id === yacimientoId)?.plantas ?? [])
  const filtrosActivos = yacimientoId !== TODOS || plantaId !== TODOS || desde || hasta
  const filtradas = filtrarVisitas(visitas, {
    yacimientoId: yacimientoId === TODOS ? undefined : yacimientoId,
    plantaId: plantaId === TODOS ? undefined : plantaId,
    desde: desde || undefined,
    hasta: hasta || undefined,
  })
  const { pendientes, historico } = separarTurnos(filtradas)

  function limpiar() {
    setYacimientoId(TODOS)
    setPlantaId(TODOS)
    setDesde("")
    setHasta("")
  }

  const sinCoincidencias = (
    <EmptyState
      icono={SearchX}
      titulo="Ningún turno coincide con los filtros"
      descripcion="Pruebe con otro Yacimiento, otra planta o un rango de fechas más amplio."
      accion={
        <Button variant="outline" size="sm" onClick={limpiar}>
          Limpiar filtros
        </Button>
      }
    />
  )

  return (
    <>
      <PageHeader
        titulo="Turnos"
        descripcion="Visitas de servicio programadas por System Solutions en los Yacimientos de su cuenta."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filtros">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="filtro-yacimiento">Yacimiento</Label>
          <Select
            value={yacimientoId}
            onValueChange={(v) => {
              if (!v) return
              setYacimientoId(v)
              setPlantaId(TODOS)
            }}
          >
            <SelectTrigger id="filtro-yacimiento" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {arboles.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="filtro-planta">Planta / locación</Label>
          <Select
            value={plantaId}
            onValueChange={(v) => v && setPlantaId(v)}
            disabled={yacimientoId === TODOS}
          >
            <SelectTrigger id="filtro-planta" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>
                {yacimientoId === TODOS ? "Elija un Yacimiento" : "Todas"}
              </SelectItem>
              {plantas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="filtro-desde">Desde</Label>
          <Input
            id="filtro-desde"
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="filtro-hasta">Hasta</Label>
          <Input
            id="filtro-hasta"
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
      </div>

      {error ? (
        <ErrorState error={error} onRetry={reintentar} />
      ) : (
        <Tabs defaultValue="pendientes" className="gap-4">
          <TabsList>
            <TabsTrigger value="pendientes">
              Pendientes <Contador n={pendientes.length} />
            </TabsTrigger>
            <TabsTrigger value="historico">
              Histórico <Contador n={historico.length} />
            </TabsTrigger>
          </TabsList>
          <TabsContent value="pendientes">
            {cargando ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : pendientes.length ? (
              <ListaTurnos visitas={pendientes} />
            ) : filtrosActivos ? (
              sinCoincidencias
            ) : (
              <EmptyState
                icono={CalendarCheck2}
                titulo="No hay turnos pendientes"
                descripcion="System Solutions programa las visitas; cuando haya una nueva aparecerá en esta lista y en el calendario."
              />
            )}
          </TabsContent>
          <TabsContent value="historico">
            {cargando ? (
              <Skeleton className="h-40 w-full rounded-xl" />
            ) : historico.length ? (
              <ListaTurnos visitas={historico} />
            ) : filtrosActivos ? (
              sinCoincidencias
            ) : (
              <EmptyState
                icono={History}
                titulo="Sin turnos en el histórico"
                descripcion="Las visitas completadas y canceladas se listan aquí."
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </>
  )
}

function Contador({ n }: { n: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
      {n}
    </span>
  )
}

/** Tabla en escritorio y tarjetas en celular. */
function ListaTurnos({ visitas }: { visitas: VisitaCliente[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Horario</TableHead>
              <TableHead>Yacimiento</TableHead>
              <TableHead>Locación y equipo</TableHead>
              <TableHead className="text-right">Válvulas</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visitas.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="tabular-nums">
                  {v.fecha ? fmt(v.fecha, "dd/MM/yyyy") : "—"}
                </TableCell>
                <TableCell className="tabular-nums">{v.horario}</TableCell>
                <TableCell>{v.yacimiento}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {v.ubicaciones.length ? v.ubicaciones.join("; ") : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{v.valvulas}</TableCell>
                <TableCell>
                  <EstadoVisitaBadge visita={v} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="space-y-3 md:hidden">
        {visitas.map((v) => (
          <li key={v.id}>
            <VisitaTarjeta visita={v} conFecha />
          </li>
        ))}
      </ul>
    </>
  )
}
