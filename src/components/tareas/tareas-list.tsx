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
import { ESTADO_TAREA_LABEL } from "@/lib/domain/rules"
import type { EstadoTarea } from "@/lib/domain/types"
import { fmt, hoyIso } from "@/lib/fechas"
import { useEmpresas, useTalleres, useTareas } from "@/lib/hooks/queries"
import type { FiltroTareas } from "@/lib/services"

import { EstadoTareaBadge, TallerChip } from "./badges"

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
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useTareas(filtro)
  const talleres = useTalleres()
  const empresas = useEmpresas({ incluirInactivas: true })

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

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Skeleton className="h-80 w-full" />
      ) : filas.length === 0 ? (
        <EmptyState
          icono={ClipboardList}
          titulo="No hay tareas con estos filtros"
          descripcion="Probá con otra vista o quitá algún filtro."
        />
      ) : (
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
      )}
    </>
  )
}
