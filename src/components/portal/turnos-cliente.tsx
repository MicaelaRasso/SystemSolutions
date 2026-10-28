"use client"

import { CalendarCheck2, History, SearchX } from "lucide-react"
import { useState } from "react"

import { BarraFiltros, CampoFiltro } from "@/components/common/barra-filtros"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { TablaResponsive, type ColumnaTabla } from "@/components/common/tabla-responsive"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Cargando } from "@/components/common/cargando"
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

      <BarraFiltros
        activos={
          [yacimientoId !== TODOS, plantaId !== TODOS, !!desde, !!hasta].filter(Boolean).length
        }
        onLimpiar={limpiar}
      >
        <CampoFiltro etiqueta="Yacimiento" htmlFor="filtro-yacimiento">
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
        </CampoFiltro>
        <CampoFiltro etiqueta="Planta / locación" htmlFor="filtro-planta">
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
        </CampoFiltro>
        <CampoFiltro etiqueta="Desde" htmlFor="filtro-desde">
          <Input
            id="filtro-desde"
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
        </CampoFiltro>
        <CampoFiltro etiqueta="Hasta" htmlFor="filtro-hasta">
          <Input
            id="filtro-hasta"
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
          />
        </CampoFiltro>
      </BarraFiltros>

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
              <Cargando texto="Cargando turnos…" />
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
              <Cargando texto="Cargando turnos…" />
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

const COLUMNAS: ColumnaTabla<VisitaCliente>[] = [
  {
    id: "fecha",
    encabezado: "Fecha",
    celda: (v) => (v.fecha ? fmt(v.fecha, "dd/MM/yyyy") : "—"),
    className: "tabular-nums",
  },
  { id: "horario", encabezado: "Horario", celda: (v) => v.horario, className: "tabular-nums" },
  { id: "yacimiento", encabezado: "Yacimiento", celda: (v) => v.yacimiento },
  {
    id: "ubicaciones",
    encabezado: "Locación y equipo",
    celda: (v) => (v.ubicaciones.length ? v.ubicaciones.join("; ") : "—"),
    className: "text-sm text-muted-foreground",
  },
  {
    id: "valvulas",
    encabezado: "Válvulas",
    celda: (v) => v.valvulas,
    className: "text-right tabular-nums",
  },
  { id: "estado", encabezado: "Estado", celda: (v) => <EstadoVisitaBadge visita={v} /> },
]

/** Tabla desde tablet y tarjetas en celular (patrón `TablaResponsive`). */
function ListaTurnos({ visitas }: { visitas: VisitaCliente[] }) {
  return (
    <TablaResponsive
      filas={visitas}
      clave={(v) => v.id}
      columnas={COLUMNAS}
      descripcion="Turnos"
      tarjeta={(v) => <VisitaTarjeta visita={v} conFecha />}
    />
  )
}
