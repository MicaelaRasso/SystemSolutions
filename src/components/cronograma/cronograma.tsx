"use client"

import { addWeeks, isToday, isWeekend, subWeeks } from "date-fns"
import { ChevronLeft, ChevronRight, CopyPlus, Plus } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { useMotivo, type PedidoMotivo } from "@/components/common/motivo-dialog"
import { PageHeader } from "@/components/common/page-header"
import { SelectNativo } from "@/components/common/select-nativo"
import { ErrorState } from "@/components/common/states"
import { COLOR_SIN_TALLER } from "@/components/tareas/badges"
import { convertirOperacionATarea, TareaSheet } from "@/components/tareas/tarea-sheet"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Cargando } from "@/components/common/cargando"
import { diasSemana, fmt, iso, lunesDe } from "@/lib/fechas"
import {
  INVALIDAR_TAREAS,
  qk,
  reasignarTarea,
  reasignarVisita,
  usaSupabase,
  useNominas,
  usePersonas,
  useOperaciones,
  useServiceMutation,
  useTalleres,
} from "@/lib/hooks/queries"
import type { OperationRead } from "@/lib/hooks/queries"
import { services, type TareaResumen } from "@/lib/services"
import { cn } from "@/lib/utils"

import { columnaMovilVigente } from "./cronograma-utils"
import { NominaEditor } from "./nomina-editor"
import { esMovible, SIN_TALLER, TareaCard } from "./tarea-card"

interface Columna {
  id: string
  nombre: string
  color: string
}

/**
 * Cronograma semanal (RF-38, RF-39): un taller móvil por columna, un día por fila.
 * Cada celda tiene la nómina del taller en esa jornada y sus tareas.
 */
const MOTIVO_REASIGNACION: PedidoMotivo = {
  titulo: "Cambio de asignación",
  etiqueta: "Motivo del cambio de asignación de la visita",
  confirmar: "Reasignar",
}

export function Cronograma() {
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const dias = useMemo(() => diasSemana(lunes), [lunes])
  const desde = iso(dias[0])
  const hasta = iso(dias[6])

  const supabase = usaSupabase()
  const { pedirMotivo, dialogo: dialogoMotivo } = useMotivo()
  const operaciones = useOperaciones({ desde, hasta })
  const tareas = (operaciones.data ?? []).map(convertirOperacionATarea)
  const talleres = useTalleres()
  const personas = usePersonas()
  const nominas = useNominas(desde, hasta)

  const [abierta, setAbierta] = useState<TareaResumen | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  // En el celular se ve un taller por vez (la grilla completa no entra).
  const [columnaElegida, setColumnaElegida] = useState<string | null>(null)

  const invalidarNominas = [["nominas"]]
  const reasignar = useServiceMutation<
    { id: string; tallerId: string | undefined; fecha: string; reason: string },
    OperationRead | TareaResumen
  >(
    ({ id, tallerId, fecha, reason }) =>
      supabase ? reasignarVisita(id, tallerId, fecha, reason) : reasignarTarea(id, tallerId, fecha),
    {
      exito: supabase ? "Asignación de visita actualizada" : "Tarea reprogramada",
      invalidar: INVALIDAR_TAREAS,
    },
  )
  const guardarNomina = useServiceMutation(
    ({ tallerId, fecha, ids }: { tallerId: string; fecha: string; ids: string[] }) =>
      services.cronograma.setNomina(tallerId, fecha, ids),
    { invalidar: [qk.nominas(desde, hasta)] },
  )
  const copiar = useServiceMutation(() => services.cronograma.copiarSemanaAnterior(desde), {
    invalidar: invalidarNominas,
  })

  // Columnas: talleres activos + los inactivos que tengan tareas esta semana.
  const columnas: Columna[] = useMemo(() => {
    const conTareas = new Set(tareas.map((t) => t.tallerId))
    const cols = (talleres.data ?? [])
      .filter((t) => t.activo || conTareas.has(t.id))
      .map((t) => ({ id: t.id, nombre: t.nombre, color: t.color }))
    return [{ id: SIN_TALLER, nombre: "Sin asignar", color: COLOR_SIN_TALLER }, ...cols]
  }, [talleres.data, tareas])

  const tareasPorCelda = useMemo(() => {
    const m = new Map<string, TareaResumen[]>()
    for (const t of tareas) {
      const k = `${t.tallerId ?? SIN_TALLER}|${t.fechaEjecucion}`
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return m
  }, [tareas])

  const nominaDe = (tallerId: string, fecha: string) =>
    nominas.data?.find((n) => n.tallerId === tallerId && n.fecha === fecha)?.personaIds ?? []

  function ocupadasEn(fecha: string, exceptoTaller: string) {
    const m = new Map<string, string>()
    for (const n of nominas.data ?? []) {
      if (n.fecha !== fecha || n.tallerId === exceptoTaller) continue
      const nombre = talleres.data?.find((t) => t.id === n.tallerId)?.nombre ?? "otro taller"
      n.personaIds.forEach((p) => m.set(p, nombre))
    }
    return m
  }

  async function soltar(e: React.DragEvent, columna: string, fecha: string) {
    e.preventDefault()
    setSobre(null)
    setArrastrando(null)
    const id = e.dataTransfer.getData("text/plain")
    const tarea = tareas.find((t) => t.id === id)
    if (!tarea || !esMovible(tarea)) return
    const tallerId = columna === SIN_TALLER ? undefined : columna
    if (tarea.tallerId === tallerId && tarea.fechaEjecucion === fecha) return
    const reason = supabase ? await pedirMotivo(MOTIVO_REASIGNACION) : ""
    if (supabase && !reason) return
    reasignar.mutate({ id, tallerId, fecha, reason: reason ?? "" })
  }

  const tareasPendientes = operaciones.isPending
  const tareasError = operaciones.error
  const tareasPlaceholder = operaciones.isPlaceholderData
  const cargando = tareasPendientes || talleres.isPending || nominas.isPending || personas.isPending
  const error = tareasError ?? talleres.error ?? nominas.error ?? personas.error

  /** Una celda taller × día: nómina y tareas. Misma pieza en la grilla y en la vista de celular. */
  function celda(c: Columna, fecha: string, finde: boolean, vista: "desktop" | "movil") {
    const clave = `${c.id}|${fecha}`
    const lista = tareasPorCelda.get(clave) ?? []
    const activas = lista.filter((t) => t.estado !== "cancelada")
    return (
      <div
        key={clave}
        role={vista === "desktop" ? "gridcell" : undefined}
        onDragOver={(e) => {
          if (!arrastrando) return
          e.preventDefault()
          if (sobre !== clave) setSobre(clave)
        }}
        onDragLeave={() => sobre === clave && setSobre(null)}
        onDrop={(e) => soltar(e, c.id, fecha)}
        className={cn(
          "flex min-h-20 flex-col gap-1 p-1.5",
          vista === "desktop" ? "border-b border-l" : "rounded-lg border",
          finde && "bg-muted/30",
          c.id === SIN_TALLER && "bg-amber-50/40",
          sobre === clave && "bg-primary/10 ring-2 ring-primary/40 ring-inset",
        )}
      >
        {c.id !== SIN_TALLER && personas.data && (
          <NominaEditor
            tallerNombre={c.nombre}
            fecha={fecha}
            seleccion={nominaDe(c.id, fecha)}
            personas={personas.data}
            ocupadas={ocupadasEn(fecha, c.id)}
            conTareas={activas.length > 0}
            guardando={guardarNomina.isPending}
            onChange={(ids) => guardarNomina.mutateAsync({ tallerId: c.id, fecha, ids })}
          />
        )}
        {lista.map((t) => (
          <TareaCard
            key={t.id}
            tarea={t}
            talleres={(talleres.data ?? []).filter((x) => x.activo)}
            onVer={() => setAbierta(t)}
            onAsignar={async (tallerId) => {
              const reason = supabase ? await pedirMotivo(MOTIVO_REASIGNACION) : ""
              if (supabase && !reason) return
              reasignar.mutate({
                id: t.id,
                tallerId,
                fecha: t.fechaEjecucion,
                reason: reason ?? "",
              })
            }}
            permitirDesasignar={!supabase}
            onDragStart={() => setArrastrando(t.id)}
            onDragEnd={() => {
              setArrastrando(null)
              setSobre(null)
            }}
          />
        ))}
      </div>
    )
  }

  const columnaMovil = columnaMovilVigente(
    columnas.map((c) => c.id),
    columnaElegida,
    SIN_TALLER,
  )
  const columnaMovilDatos = columnas.find((c) => c.id === columnaMovil)
  const cantidadDe = (id: string) =>
    tareas.filter((t) => (t.tallerId ?? SIN_TALLER) === id && t.estado !== "cancelada").length

  return (
    <>
      <PageHeader
        titulo="Cronograma"
        descripcion="Planificación semanal por taller móvil. Arrastrá una tarea para cambiarle el taller o el día."
        acciones={
          <Button asChild>
            <Link href="/admin/tareas/nueva">
              <Plus />
              Nueva tarea
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-52 text-lg font-semibold">
          {fmt(dias[0], "d MMM")} – {fmt(dias[6], "d MMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Semana anterior"
            onClick={() => setLunes((l) => subWeeks(l, 1))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setLunes(lunesDe(new Date()))}>
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Semana siguiente"
            onClick={() => setLunes((l) => addWeeks(l, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button
          variant="outline"
          className="w-full sm:ml-auto sm:w-auto"
          disabled={copiar.isPending}
          onClick={() =>
            copiar.mutate(undefined, {
              onSuccess: (n) =>
                n > 0
                  ? toast.success(`Se copiaron ${n} ${n === 1 ? "nómina" : "nóminas"}`)
                  : toast.info("No había jornadas vacías para completar"),
            })
          }
        >
          <CopyPlus />
          Copiar nómina de la semana anterior
        </Button>
      </div>

      {error ? (
        <ErrorState
          error={error}
          onRetry={() => {
            operaciones.refetch()
            talleres.refetch()
            nominas.refetch()
            personas.refetch()
          }}
        />
      ) : cargando ? (
        <Cargando texto="Cargando cronograma…" />
      ) : (
        <>
          {/* Celular: un taller por vez, un día por bloque. */}
          <div
            className={cn(
              "space-y-3 transition-opacity md:hidden",
              (tareasPlaceholder || nominas.isPlaceholderData) && "opacity-60",
            )}
          >
            <div className="space-y-1.5">
              <Label htmlFor="cronograma-taller">Taller</Label>
              <SelectNativo
                id="cronograma-taller"
                value={columnaMovil}
                onChange={(e) => setColumnaElegida(e.target.value)}
              >
                {columnas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} ({cantidadDe(c.id)})
                  </option>
                ))}
              </SelectNativo>
            </div>
            {columnaMovilDatos &&
              dias.map((d) => {
                const fecha = iso(d)
                return (
                  <section
                    key={fecha}
                    aria-label={fmt(d, "EEEE d 'de' MMMM")}
                    className="space-y-1.5"
                  >
                    <h3
                      className={cn(
                        "flex items-baseline gap-2 text-sm font-medium capitalize",
                        isWeekend(d) && "text-muted-foreground",
                      )}
                    >
                      {fmt(d, "EEEE")}
                      <span
                        className={cn(
                          "text-xs font-normal tabular-nums",
                          isToday(d)
                            ? "rounded bg-primary px-1 text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {fmt(d, "dd/MM")}
                      </span>
                    </h3>
                    {celda(columnaMovilDatos, fecha, isWeekend(d), "movil")}
                  </section>
                )
              })}
          </div>

          {/* Tablet y escritorio: grilla con desplazamiento propio y primera columna fija. */}
          <p className="hidden text-xs text-muted-foreground pointer-coarse:md:block">
            Deslizá la grilla hacia los costados para ver todos los talleres.
          </p>
          <div
            tabIndex={0}
            role="region"
            aria-label="Cronograma semanal, se desplaza hacia los costados"
            className={cn(
              "hidden overflow-x-auto rounded-xl border bg-card transition-opacity md:block",
              (tareasPlaceholder || nominas.isPlaceholderData) && "opacity-60",
            )}
          >
            <div
              role="grid"
              aria-label="Cronograma semanal"
              className="grid min-w-max"
              style={{
                gridTemplateColumns: `6.5rem minmax(11rem, 1fr) repeat(${columnas.length - 1}, minmax(13rem, 1fr))`,
              }}
            >
              {/* Encabezado */}
              <div role="columnheader" className="sticky left-0 z-10 border-b bg-muted/60" />
              {columnas.map((c) => (
                <div
                  key={c.id}
                  role="columnheader"
                  className="flex items-center gap-2 border-b border-l bg-muted/60 px-3 py-2 text-sm font-medium"
                >
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                  {c.nombre}
                </div>
              ))}

              {/* Un día por fila */}
              {dias.map((d) => {
                const fecha = iso(d)
                const finde = isWeekend(d)
                return (
                  <div key={fecha} role="row" className="contents">
                    <div
                      role="rowheader"
                      className={cn(
                        "sticky left-0 z-10 border-b bg-card px-3 py-2 text-sm",
                        finde && "bg-muted/40 text-muted-foreground",
                      )}
                    >
                      <div className="font-medium capitalize">{fmt(d, "EEEE")}</div>
                      <div
                        className={cn(
                          "text-xs tabular-nums",
                          isToday(d)
                            ? "inline-block rounded bg-primary px-1 text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {fmt(d, "dd/MM")}
                      </div>
                    </div>
                    {columnas.map((c) => celda(c, fecha, finde, "desktop"))}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      <TareaSheet tarea={abierta} onOpenChange={(o) => !o && setAbierta(null)} />
      {dialogoMotivo}
    </>
  )
}
