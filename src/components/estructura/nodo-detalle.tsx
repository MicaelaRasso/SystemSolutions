"use client"

import { ChevronRight, Pencil, Plus, Trash2 } from "lucide-react"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { EmptyState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { ID, NivelEstructura } from "@/lib/domain/types"
import { plural } from "@/lib/format"
import { useServiceMutation, qk } from "@/lib/hooks/queries"
import { services } from "@/lib/services"

import { NIVEL, type Seleccion, type Ubicacion } from "./arbol-utils"
import { EquipoDialog, PlantaDialog, ValvulaDialog, YacimientoDialog } from "./dialogs"
import { ValvulaFicha } from "./valvula-ficha"

interface Props {
  empresaId: ID
  nivel: NivelEstructura
  ubicacion: Ubicacion
  onSeleccionar: (s: Seleccion | null) => void
}

function Migas({ ubicacion, nivel, onSeleccionar }: Omit<Props, "empresaId">) {
  const pasos: (Seleccion & { label: string })[] = [
    { nivel: "yacimiento", id: ubicacion.yacimiento.id, label: ubicacion.yacimiento.nombre },
  ]
  if (ubicacion.planta)
    pasos.push({ nivel: "planta", id: ubicacion.planta.id, label: ubicacion.planta.nombre })
  if (ubicacion.equipo)
    pasos.push({ nivel: "equipo", id: ubicacion.equipo.id, label: ubicacion.equipo.nombre })
  const previos = pasos.filter((p) => p.nivel !== nivel)
  if (previos.length === 0) return null

  return (
    <nav
      aria-label="Ubicación"
      className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
    >
      {previos.map((p, i) => (
        <span key={p.id} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5" />}
          <button
            type="button"
            className="hover:text-foreground hover:underline"
            onClick={() => onSeleccionar(p)}
          >
            {p.label}
          </button>
        </span>
      ))}
    </nav>
  )
}

function Encabezado({
  nivel,
  titulo,
  subtitulo,
  acciones,
}: {
  nivel: NivelEstructura
  titulo: string
  subtitulo?: React.ReactNode
  acciones: React.ReactNode
}) {
  const Icono = NIVEL[nivel].icono
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className="rounded-lg bg-accent p-2 text-accent-foreground">
          <Icono className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {NIVEL[nivel].label}
          </p>
          <h2 className="text-xl font-semibold">{titulo}</h2>
          {subtitulo && <p className="text-sm text-muted-foreground">{subtitulo}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">{acciones}</div>
    </div>
  )
}

function Hijos({
  titulo,
  items,
  accion,
  vacio,
  onSeleccionar,
}: {
  titulo: string
  items: (Seleccion & { label: string; detalle?: React.ReactNode })[]
  accion: React.ReactNode
  vacio: string
  onSeleccionar: (s: Seleccion) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">
          {titulo} <span className="font-normal text-muted-foreground">({items.length})</span>
        </CardTitle>
        {accion}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{vacio}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((it) => {
              const Icono = NIVEL[it.nivel].icono
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => onSeleccionar(it)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60"
                  >
                    <Icono className="size-4 text-muted-foreground" />
                    <span className="font-medium">{it.label}</span>
                    <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {it.detalle}
                      <ChevronRight className="size-4" />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

const botonEditar = (
  <Button variant="outline" size="sm">
    <Pencil />
    Editar
  </Button>
)
const botonEliminar = (
  <Button variant="destructive" size="sm">
    <Trash2 />
    Eliminar
  </Button>
)
const botonAgregar = (label: string) => (
  <Button size="sm" variant="secondary">
    <Plus />
    {label}
  </Button>
)

export function NodoDetalle({ empresaId, nivel, ubicacion, onSeleccionar }: Props) {
  const invalidar = [qk.arbol(empresaId), ["empresas"]]
  const eliminar = useServiceMutation(
    (s: Seleccion) => {
      switch (s.nivel) {
        case "yacimiento":
          return services.estructura.deleteYacimiento(s.id)
        case "planta":
          return services.estructura.deletePlanta(s.id)
        case "equipo":
          return services.estructura.deleteEquipo(s.id)
        case "valvula":
          return services.estructura.deleteValvula(s.id)
      }
    },
    { exito: "Eliminado", invalidar },
  )

  /** Elimina y vuelve al nivel superior. */
  function confirmarEliminar(s: Seleccion, padre: Seleccion | null) {
    return eliminar.mutateAsync(s).then(() => onSeleccionar(padre))
  }

  const { yacimiento, planta, equipo, valvula } = ubicacion
  const migas = <Migas ubicacion={ubicacion} nivel={nivel} onSeleccionar={onSeleccionar} />

  if (nivel === "valvula" && valvula && equipo) {
    return (
      <div className="space-y-4">
        {migas}
        <Encabezado
          nivel="valvula"
          titulo={valvula.tag}
          subtitulo={[valvula.marca, valvula.servicio].filter(Boolean).join(" · ") || undefined}
          acciones={
            <>
              <ValvulaDialog
                empresaId={empresaId}
                equipoId={equipo.id}
                valvula={valvula}
                trigger={botonEditar}
              />
              {valvula.certificados > 0 ? (
                // RN-03: el histórico de certificados se conserva, la válvula no se puede borrar.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button variant="destructive" size="sm" disabled>
                        <Trash2 />
                        Eliminar
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Tiene certificados emitidos: se conserva por el histórico
                  </TooltipContent>
                </Tooltip>
              ) : (
                <ConfirmDialog
                  trigger={botonEliminar}
                  titulo={`¿Eliminar ${valvula.tag}?`}
                  descripcion="La válvula se elimina de la estructura del cliente."
                  onConfirm={() =>
                    confirmarEliminar(
                      { nivel: "valvula", id: valvula.id },
                      { nivel: "equipo", id: equipo.id },
                    )
                  }
                />
              )}
            </>
          }
        />
        <ValvulaFicha valvula={valvula} />
      </div>
    )
  }

  if (nivel === "equipo" && equipo && planta) {
    return (
      <div className="space-y-4">
        {migas}
        <Encabezado
          nivel="equipo"
          titulo={equipo.nombre}
          subtitulo={equipo.descripcion}
          acciones={
            <>
              <EquipoDialog
                empresaId={empresaId}
                plantaId={planta.id}
                equipo={equipo}
                trigger={botonEditar}
              />
              <ConfirmDialog
                trigger={botonEliminar}
                titulo={`¿Eliminar el equipo ${equipo.nombre}?`}
                descripcion="Solo se pueden eliminar equipos sin válvulas cargadas."
                onConfirm={() =>
                  confirmarEliminar(
                    { nivel: "equipo", id: equipo.id },
                    { nivel: "planta", id: planta.id },
                  )
                }
              />
            </>
          }
        />
        <Hijos
          titulo="Válvulas de seguridad"
          vacio="Este equipo todavía no tiene válvulas."
          onSeleccionar={onSeleccionar}
          accion={
            <ValvulaDialog
              empresaId={empresaId}
              equipoId={equipo.id}
              trigger={botonAgregar("Válvula")}
              onSaved={(id) => onSeleccionar({ nivel: "valvula", id })}
            />
          }
          items={equipo.valvulas.map((v) => ({
            nivel: "valvula",
            id: v.id,
            label: v.tag,
            detalle: (
              <>
                {v.marca && <span className="hidden sm:inline">{v.marca}</span>}
                {!v.nroSerie && <Badge variant="outline">Serie a relevar</Badge>}
                <span>{plural(v.certificados, "certificado")}</span>
              </>
            ),
          }))}
        />
      </div>
    )
  }

  if (nivel === "planta" && planta) {
    return (
      <div className="space-y-4">
        {migas}
        <Encabezado
          nivel="planta"
          titulo={planta.nombre}
          acciones={
            <>
              <PlantaDialog
                empresaId={empresaId}
                yacimientoId={yacimiento.id}
                planta={planta}
                trigger={botonEditar}
              />
              <ConfirmDialog
                trigger={botonEliminar}
                titulo={`¿Eliminar ${planta.nombre}?`}
                descripcion="Solo se pueden eliminar plantas sin equipos cargados."
                onConfirm={() =>
                  confirmarEliminar(
                    { nivel: "planta", id: planta.id },
                    { nivel: "yacimiento", id: yacimiento.id },
                  )
                }
              />
            </>
          }
        />
        <Hijos
          titulo="Equipos / unidades"
          vacio="Esta planta todavía no tiene equipos."
          onSeleccionar={onSeleccionar}
          accion={
            <EquipoDialog
              empresaId={empresaId}
              plantaId={planta.id}
              trigger={botonAgregar("Equipo")}
              onSaved={(id) => onSeleccionar({ nivel: "equipo", id })}
            />
          }
          items={planta.equipos.map((e) => ({
            nivel: "equipo",
            id: e.id,
            label: e.nombre,
            detalle: plural(e.valvulas.length, "válvula"),
          }))}
        />
      </div>
    )
  }

  if (nivel === "yacimiento") {
    return (
      <div className="space-y-4">
        <Encabezado
          nivel="yacimiento"
          titulo={yacimiento.nombre}
          subtitulo={`${yacimiento.provincia} · Operadora: ${yacimiento.operadora}`}
          acciones={
            <>
              <YacimientoDialog
                empresaId={empresaId}
                yacimiento={yacimiento}
                trigger={botonEditar}
              />
              <ConfirmDialog
                trigger={botonEliminar}
                titulo={`¿Eliminar ${yacimiento.nombre}?`}
                descripcion="Solo se pueden eliminar yacimientos sin plantas cargadas. Se quitan también los accesos de usuarios a este yacimiento."
                onConfirm={() =>
                  confirmarEliminar({ nivel: "yacimiento", id: yacimiento.id }, null)
                }
              />
            </>
          }
        />
        <Hijos
          titulo="Plantas / locaciones"
          vacio="Este yacimiento todavía no tiene plantas."
          onSeleccionar={onSeleccionar}
          accion={
            <PlantaDialog
              empresaId={empresaId}
              yacimientoId={yacimiento.id}
              trigger={botonAgregar("Planta")}
              onSaved={(id) => onSeleccionar({ nivel: "planta", id })}
            />
          }
          items={yacimiento.plantas.map((p) => ({
            nivel: "planta",
            id: p.id,
            label: p.nombre,
            detalle: `${plural(p.equipos.length, "equipo")} · ${plural(
              p.equipos.reduce((n, e) => n + e.valvulas.length, 0),
              "válvula",
            )}`,
          }))}
        />
      </div>
    )
  }

  return <EmptyState titulo="Elemento no encontrado" />
}
