"use client"

import { useRef, useState } from "react"

import { MonthCalendar } from "@/components/common/month-calendar"
import { PageHeader } from "@/components/common/page-header"
import { ErrorState } from "@/components/common/states"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { fmtDiaLargo, iso } from "@/lib/fechas"

import { useVisitasCliente } from "./use-visitas-cliente"
import { VisitaPill, VisitaTarjeta } from "./visita-cliente-item"
import { COLOR_ESTADO_VISITA, type VisitaCliente } from "./visitas-cliente"

const ETIQUETAS = { singular: "visita", plural: "visitas", vacio: "Sin visitas este día" }
const fechaDe = (v: VisitaCliente) => v.fecha

/**
 * Calendario mensual del Cliente (RF-35, RF-39, CA-15): visitas de su alcance por día,
 * detalle del día elegido y, en celular, agenda del mes. Solo lectura: el Cliente no
 * solicita turnos (RF-36).
 */
export function CalendarioCliente() {
  const { visitas, cargando, error, reintentar } = useVisitasCliente()
  const [mes, setMes] = useState(() => new Date())
  const [dia, setDia] = useState(() => iso(new Date()))
  const [verCanceladas, setVerCanceladas] = useState(false)
  const panel = useRef<HTMLElement>(null)

  const visibles = visitas.filter((v) => verCanceladas || v.estado !== "cancelada")
  const delDia = visibles
    .filter((v) => v.fecha === dia)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))

  function elegir(visita: VisitaCliente) {
    setDia(visita.fecha)
    if (window.matchMedia("(max-width: 1279px)").matches) {
      panel.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }

  return (
    <>
      <PageHeader
        titulo="Calendario"
        descripcion="Visitas de servicio en los Yacimientos de su cuenta. Elija un día o una visita para ver el detalle."
      />

      {error ? (
        <ErrorState error={error} onRetry={reintentar} />
      ) : (
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-3">
            {!cargando && visitas.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Todavía no hay visitas registradas para sus Yacimientos. Cuando System Solutions
                programe una, aparecerá en este calendario.
              </p>
            )}
            <MonthCalendar
              mes={mes}
              onMesChange={setMes}
              items={visibles}
              claveDe={(v) => v.id}
              fechaDe={fechaDe}
              colorDe={(v) => COLOR_ESTADO_VISITA[v.estado]}
              cargando={cargando}
              etiquetas={ETIQUETAS}
              vistaMovil="agenda"
              onDiaSeleccionado={setDia}
              acciones={
                <div className="flex items-center gap-2">
                  <Switch
                    id="ver-canceladas"
                    checked={verCanceladas}
                    onCheckedChange={setVerCanceladas}
                  />
                  <Label htmlFor="ver-canceladas" className="font-normal">
                    Mostrar canceladas
                  </Label>
                </div>
              }
              renderItem={(v) => <VisitaPill visita={v} onClick={() => elegir(v)} />}
            />
          </div>

          <aside
            ref={panel}
            aria-label="Detalle del día"
            className="min-w-0 scroll-mt-16 space-y-3 self-start xl:sticky xl:top-16"
          >
            <h2 className="font-medium capitalize">{fmtDiaLargo(dia)}</h2>
            {delDia.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                Sin visitas este día.
              </p>
            ) : (
              delDia.map((v) => <VisitaTarjeta key={v.id} visita={v} />)
            )}
          </aside>
        </div>
      )}
    </>
  )
}
