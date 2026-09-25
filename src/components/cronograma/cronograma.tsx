"use client"

import { addWeeks, isToday, isWeekend, subWeeks } from "date-fns"
import { ChevronLeft, ChevronRight, CopyPlus, Plus } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/common/page-header"
import { ErrorState } from "@/components/common/states"
import { COLOR_SIN_TALLER } from "@/components/tareas/badges"
import { TareaSheet } from "@/components/tareas/tarea-sheet"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { diasSemana, fmt, iso, lunesDe } from "@/lib/fechas"
import {
  INVALIDAR_TAREAS,
  qk,
  useNominas,
  usePersonas,
  useServiceMutation,
  useTalleres,
  useTareas,
} from "@/lib/hooks/queries"
import { services, type TareaResumen } from "@/lib/services"
import { cn } from "@/lib/utils"

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
export function Cronograma() {
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const dias = useMemo(() => diasSemana(lunes), [lunes])
  const desde = iso(dias[0])
  const hasta = iso(dias[6])

  const tareas = useTareas({ desde, hasta })
  const talleres = useTalleres()
  const personas = usePersonas()
  const nominas = useNominas(desde, hasta)

  const [abierta, setAbierta] = useState<TareaResumen | null>(null)
  const [arrastrando, setArrastrando] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)

  const invalidarNominas = [["nominas"]]
  const reasignar = useServiceMutation(
    ({ id, tallerId, fecha }: { id: string; tallerId: string | undefined; fecha: string }) =>
      services.tareas.update(id, { tallerId, fechaEjecucion: fecha }),
    { exito: "Tarea reprogramada", invalidar: INVALIDAR_TAREAS },
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
    const conTareas = new Set((tareas.data ?? []).map((t) => t.tallerId))
    const cols = (talleres.data ?? [])
      .filter((t) => t.activo || conTareas.has(t.id))
      .map((t) => ({ id: t.id, nombre: t.nombre, color: t.color }))
    return [{ id: SIN_TALLER, nombre: "Sin asignar", color: COLOR_SIN_TALLER }, ...cols]
  }, [talleres.data, tareas.data])

  const tareasPorCelda = useMemo(() => {
    const m = new Map<string, TareaResumen[]>()
    for (const t of tareas.data ?? []) {
      const k = `${t.tallerId ?? SIN_TALLER}|${t.fechaEjecucion}`
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return m
  }, [tareas.data])

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

  function soltar(e: React.DragEvent, columna: string, fecha: string) {
    e.preventDefault()
    setSobre(null)
    setArrastrando(null)
    const id = e.dataTransfer.getData("text/plain")
    const tarea = tareas.data?.find((t) => t.id === id)
    if (!tarea || !esMovible(tarea)) return
    const tallerId = columna === SIN_TALLER ? undefined : columna
    if (tarea.tallerId === tallerId && tarea.fechaEjecucion === fecha) return
    reasignar.mutate({ id, tallerId, fecha })
  }

  const cargando = tareas.isPending || talleres.isPending || nominas.isPending || personas.isPending
  const error = tareas.error ?? talleres.error ?? nominas.error ?? personas.error

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
          className="ml-auto"
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
            tareas.refetch()
            talleres.refetch()
            nominas.refetch()
            personas.refetch()
          }}
        />
      ) : cargando ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : (
        <div
          className={cn(
            "overflow-x-auto rounded-xl border bg-card transition-opacity",
            (tareas.isPlaceholderData || nominas.isPlaceholderData) && "opacity-60",
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
                  {columnas.map((c) => {
                    const clave = `${c.id}|${fecha}`
                    const lista = tareasPorCelda.get(clave) ?? []
                    const activas = lista.filter((t) => t.estado !== "cancelada")
                    return (
                      <div
                        key={clave}
                        role="gridcell"
                        onDragOver={(e) => {
                          if (!arrastrando) return
                          e.preventDefault()
                          if (sobre !== clave) setSobre(clave)
                        }}
                        onDragLeave={() => sobre === clave && setSobre(null)}
                        onDrop={(e) => soltar(e, c.id, fecha)}
                        className={cn(
                          "flex min-h-20 flex-col gap-1 border-b border-l p-1.5",
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
                            onChange={(ids) =>
                              guardarNomina.mutateAsync({ tallerId: c.id, fecha, ids })
                            }
                          />
                        )}
                        {lista.map((t) => (
                          <TareaCard
                            key={t.id}
                            tarea={t}
                            talleres={(talleres.data ?? []).filter((x) => x.activo)}
                            onVer={() => setAbierta(t)}
                            onAsignar={(tallerId) =>
                              reasignar.mutate({ id: t.id, tallerId, fecha: t.fechaEjecucion })
                            }
                            onDragStart={() => setArrastrando(t.id)}
                            onDragEnd={() => {
                              setArrastrando(null)
                              setSobre(null)
                            }}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <TareaSheet tarea={abierta} onOpenChange={(o) => !o && setAbierta(null)} />
    </>
  )
}
