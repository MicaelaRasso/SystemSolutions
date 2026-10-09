import { EstadoTareaBadge } from "@/components/tareas/badges"
import { ESTADO_OPERACION_A_TAREA } from "@/components/tareas/estado-operacion"
import { fmtDiaLargo } from "@/lib/fechas"
import { cn } from "@/lib/utils"

import { COLOR_ESTADO_VISITA, type VisitaCliente } from "./visitas-cliente"

export function EstadoVisitaBadge({ visita }: { visita: VisitaCliente }) {
  return <EstadoTareaBadge estado={ESTADO_OPERACION_A_TAREA[visita.estado]} />
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** Elemento compacto de la grilla del calendario: horario, yacimiento y locación. */
export function VisitaPill({
  visita,
  onClick,
  seleccionada,
}: {
  visita: VisitaCliente
  onClick: () => void
  seleccionada?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={seleccionada}
      className={cn(
        "flex w-full items-start gap-1.5 rounded-md bg-muted/60 px-1.5 py-1 text-left text-xs leading-tight transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none max-md:border max-md:bg-card max-md:p-3 max-md:text-sm",
        seleccionada && "bg-accent ring-1 ring-ring/40",
        visita.estado === "cancelada" && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className="mt-1 size-2 shrink-0 rounded-full"
        style={{ backgroundColor: COLOR_ESTADO_VISITA[visita.estado] }}
      />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate font-medium",
            visita.estado === "cancelada" && "line-through",
          )}
        >
          <span className="tabular-nums">{visita.horario.split("–")[0]}</span> {visita.yacimiento}
        </span>
        <span className="block truncate text-muted-foreground">
          {visita.ubicaciones[0] ?? plural(visita.valvulas, "válvula", "válvulas")}
        </span>
        <span className="mt-1 hidden max-md:block">
          <EstadoVisitaBadge visita={visita} />
        </span>
      </span>
    </button>
  )
}

/** Detalle de una visita: horario, ubicación, válvulas, taller y estado. */
export function VisitaTarjeta({
  visita,
  conFecha = false,
}: {
  visita: VisitaCliente
  conFecha?: boolean
}) {
  return (
    <article className="space-y-2 rounded-lg border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {conFecha && visita.fecha && (
            <p className="font-medium capitalize">{fmtDiaLargo(visita.fecha)}</p>
          )}
          <p className={cn("tabular-nums", conFecha ? "text-muted-foreground" : "font-medium")}>
            {visita.horario}
          </p>
        </div>
        <EstadoVisitaBadge visita={visita} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Yacimiento</dt>
        <dd className="min-w-0 break-words">{visita.yacimiento}</dd>
        <dt className="text-muted-foreground">Locación</dt>
        <dd className="min-w-0 break-words">
          {visita.ubicaciones.length ? (
            <ul>
              {visita.ubicaciones.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : (
            <span className="text-muted-foreground">Sin datos de locación</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Válvulas</dt>
        <dd className="tabular-nums">{visita.valvulas}</dd>
        <dt className="text-muted-foreground">Taller</dt>
        <dd>{visita.tallerAsignado ? "Asignado" : "A confirmar"}</dd>
      </dl>
    </article>
  )
}
