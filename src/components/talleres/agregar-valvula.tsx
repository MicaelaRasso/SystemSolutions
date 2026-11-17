"use client"

import { useMemo, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Plus, Search } from "lucide-react"
import { toast } from "sonner"

import { FormDialog, PieFormulario } from "@/components/common/form-dialog"
import { SelectNativo } from "@/components/common/select-nativo"
import {
  CamposValvula,
  inputDesdeValvula,
  type OpcionesValvula,
} from "@/components/estructura/dialogs"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { edgeApi } from "@/lib/api"
import { valvulaSchema, type ValvulaInput } from "@/lib/domain/schemas"
import { useServiceMutation } from "@/lib/hooks/queries"
import { getOfflineDeviceId as deviceId } from "@/lib/offline/device"
import type { OfflineStore, OfflineSyncCoordinator, VisitaOffline } from "@/lib/offline/sync"
import {
  arbolesDeLaVisita,
  buscarValvulas,
  datosDeValvulaDeCampo,
  equiposDelCatalogo,
  valvulasDelCatalogo,
  type EquipoCatalogo,
  type ValvulaCatalogo,
} from "./valvulas-campo"

/** Cuántos resultados del buscador se muestran a la vez (el resto se encuentra afinando la búsqueda). */
const MAXIMO_RESULTADOS = 50

type ContextoVisita = { context?: unknown; client_yacimientos?: unknown }

/** Operaciones de inicio de la visita que todavía no llegaron al servidor. */
async function inicioPendiente(store: OfflineStore, visitId: string) {
  return (await store.listOperations(visitId))
    .filter((operation) => operation.kind === "start_visit" && operation.estado !== "sincronizada")
    .map((operation) => operation.operationId)
}

/**
 * Agrega una orden a la visita. Con conexión y sin cambios pendientes va directo al servidor; si no,
 * se encola (el id de la orden se genera acá, así lo que se cargue después la referencia) y se
 * sincroniza con el resto de la visita.
 */
async function agregarOrden(input: {
  visit: VisitaOffline
  store: OfflineStore
  coordinator: OfflineSyncCoordinator
  enLinea: () => Promise<unknown>
  kind: "add_work_order" | "create_valve"
  payload: Record<string, unknown> & { work_order_id: string }
}): Promise<"servidor" | "dispositivo"> {
  const operations = await input.store.listOperations(input.visit.id)
  const pendientes = operations.some((operation) => operation.estado !== "sincronizada")
  if (navigator.onLine && !pendientes) {
    await input.enLinea()
    return "servidor"
  }
  await input.coordinator.queue(
    input.visit.id,
    deviceId(),
    input.kind,
    input.payload,
    await inicioPendiente(input.store, input.visit.id),
  )
  return "dispositivo"
}

function avisoDeAlta(nombre: string, destino: "servidor" | "dispositivo") {
  return destino === "servidor"
    ? `Válvula ${nombre} agregada a la visita.`
    : `Válvula ${nombre} agregada en el dispositivo; se sincroniza con la visita.`
}

export function AgregarValvula({
  visit,
  store,
  coordinator,
  valvulasEnLaVisita,
  opciones,
  disabled,
  onChanged,
}: {
  visit: VisitaOffline
  store: OfflineStore
  coordinator: OfflineSyncCoordinator
  /** Ids de las válvulas que ya tienen orden en la visita (incluidas las agregadas sin conexión). */
  valvulasEnLaVisita: ReadonlySet<string>
  /** Opciones de los desplegables de la ficha, descargadas con la visita. */
  opciones: OpcionesValvula
  disabled: boolean
  onChanged: () => Promise<void>
}) {
  return (
    <FormDialog
      titulo="Agregar válvula"
      descripcion="Sumá a la visita una válvula del catálogo del Cliente o da de alta una nueva. Funciona sin conexión."
      ancho="sm:max-w-3xl"
      trigger={
        <Button type="button" variant="outline" className="max-sm:w-full" disabled={disabled}>
          <Plus className="mr-2 size-4" /> Agregar válvula
        </Button>
      }
    >
      {(cerrar) => (
        <Tabs defaultValue="catalogo">
          <TabsList className="w-full">
            <TabsTrigger value="catalogo">Del catálogo</TabsTrigger>
            <TabsTrigger value="nueva">Nueva válvula</TabsTrigger>
          </TabsList>
          <TabsContent value="catalogo" className="pt-3">
            <BuscadorDeValvulas
              visit={visit}
              store={store}
              coordinator={coordinator}
              valvulasEnLaVisita={valvulasEnLaVisita}
              cerrar={cerrar}
              onChanged={onChanged}
            />
          </TabsContent>
          <TabsContent value="nueva" className="pt-3">
            <NuevaValvula
              visit={visit}
              store={store}
              coordinator={coordinator}
              opciones={opciones}
              cerrar={cerrar}
              onChanged={onChanged}
            />
          </TabsContent>
        </Tabs>
      )}
    </FormDialog>
  )
}

/** Equipos agrupados por yacimiento para el desplegable del alta. */
function porYacimiento(equipos: EquipoCatalogo[]) {
  const grupos = new Map<string, { nombre: string; equipos: EquipoCatalogo[] }>()
  for (const equipo of equipos) {
    const grupo = grupos.get(equipo.yacimientoId) ?? {
      nombre: equipo.yacimientoNombre,
      equipos: [],
    }
    grupo.equipos.push(equipo)
    grupos.set(equipo.yacimientoId, grupo)
  }
  return [...grupos.entries()]
}

/**
 * Alta de una válvula nueva con los mismos campos que el Administrador (decisión (a)): queda
 * definitiva en el catálogo del Cliente y se suma a la visita. El equipo tiene que existir.
 */
function NuevaValvula({
  visit,
  store,
  coordinator,
  opciones,
  cerrar,
  onChanged,
}: {
  visit: VisitaOffline
  store: OfflineStore
  coordinator: OfflineSyncCoordinator
  opciones: OpcionesValvula
  cerrar: () => void
  onChanged: () => Promise<void>
}) {
  const equipos = useMemo(
    () => equiposDelCatalogo(arbolesDeLaVisita((visit.context ?? {}) as ContextoVisita)),
    [visit.context],
  )
  const [equipoId, setEquipoId] = useState(() => (equipos.length === 1 ? equipos[0].id : ""))
  const [errorEquipo, setErrorEquipo] = useState<string>()
  // Ids generados una sola vez por formulario: reintentar el alta no duplica la válvula.
  const [ids] = useState(() => ({
    valvula: window.crypto.randomUUID(),
    orden: window.crypto.randomUUID(),
  }))
  const form = useForm<ValvulaInput>({
    resolver: zodResolver(valvulaSchema),
    defaultValues: inputDesdeValvula(),
  })

  const crear = useServiceMutation(async (data: ValvulaInput) => {
    const valvula = datosDeValvulaDeCampo(data)
    const equipo = equipos.find((candidato) => candidato.id === equipoId)
    const destino = await agregarOrden({
      visit,
      store,
      coordinator,
      kind: "create_valve",
      enLinea: () =>
        edgeApi.workOrders.createFieldValve(visit.id, {
          valvulaId: ids.valvula,
          equipoId,
          workOrderId: ids.orden,
          valvula,
        }),
      payload: {
        work_order_id: ids.orden,
        valvula_id: ids.valvula,
        equipo_id: equipoId,
        equipo_nombre: equipo?.nombre,
        valvula,
      },
    })
    await onChanged()
    return { destino, nombre: valvula.nombre }
  })

  if (equipos.length === 0)
    return (
      <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
        No hay equipos del Cliente descargados para esta visita. Actualizá la agenda con conexión;
        en campo no se crean equipos.
      </p>
    )

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((data) => {
        if (!equipoId) {
          setErrorEquipo("Elegí el equipo de la válvula.")
          return
        }
        crear.mutate(data, {
          onSuccess: ({ destino, nombre }) => {
            toast.success(avisoDeAlta(nombre, destino))
            cerrar()
          },
        })
      })}
    >
      <FieldGroup>
        <Field data-invalid={!!errorEquipo}>
          <FieldLabel htmlFor={`equipo-valvula-${visit.id}`}>Equipo</FieldLabel>
          <SelectNativo
            id={`equipo-valvula-${visit.id}`}
            value={equipoId}
            aria-invalid={!!errorEquipo}
            onChange={(event) => {
              setEquipoId(event.target.value)
              setErrorEquipo(undefined)
            }}
          >
            <option value="">Elegí el equipo</option>
            {porYacimiento(equipos).map(([yacimientoId, grupo]) => (
              <optgroup key={yacimientoId} label={grupo.nombre || "Yacimiento"}>
                {grupo.equipos.map((equipo) => (
                  <option key={equipo.id} value={equipo.id}>
                    {equipo.plantaNombre
                      ? `${equipo.nombre} · ${equipo.plantaNombre}`
                      : equipo.nombre}
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectNativo>
          <FieldError errors={errorEquipo ? [{ message: errorEquipo }] : []} />
        </Field>
        <CamposValvula form={form} opciones={opciones} />
        <PieFormulario pendiente={crear.isPending} cerrar={cerrar} crear />
      </FieldGroup>
    </form>
  )
}

function BuscadorDeValvulas({
  visit,
  store,
  coordinator,
  valvulasEnLaVisita,
  cerrar,
  onChanged,
}: {
  visit: VisitaOffline
  store: OfflineStore
  coordinator: OfflineSyncCoordinator
  valvulasEnLaVisita: ReadonlySet<string>
  cerrar: () => void
  onChanged: () => Promise<void>
}) {
  const [consulta, setConsulta] = useState("")
  const catalogo = useMemo(
    () =>
      valvulasDelCatalogo(
        arbolesDeLaVisita((visit.context ?? {}) as ContextoVisita),
        valvulasEnLaVisita,
      ),
    [visit.context, valvulasEnLaVisita],
  )
  const resultados = buscarValvulas(catalogo, consulta)

  const agregar = useServiceMutation(async (valvula: ValvulaCatalogo) => {
    const workOrderId = window.crypto.randomUUID()
    const destino = await agregarOrden({
      visit,
      store,
      coordinator,
      kind: "add_work_order",
      enLinea: () => edgeApi.workOrders.addWorkOrder(visit.id, valvula.id, workOrderId),
      payload: {
        work_order_id: workOrderId,
        valvula_id: valvula.id,
        valvula_nombre: valvula.nombre,
        equipo_nombre: valvula.equipoNombre,
        valvula: valvula.valvula,
      },
    })
    await onChanged()
    return destino
  })

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={`buscar-valvula-${visit.id}`}>Buscar en el catálogo</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`buscar-valvula-${visit.id}`}
            value={consulta}
            onChange={(event) => setConsulta(event.target.value)}
            placeholder="TAG, equipo, planta o N° de serie"
            className="pl-8"
            autoFocus
          />
        </div>
      </div>
      {catalogo.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          No hay otras válvulas del Cliente descargadas para esta visita. Actualizá la agenda con
          conexión para traer el catálogo.
        </p>
      ) : resultados.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
          Ninguna válvula coincide con «{consulta.trim()}».
        </p>
      ) : (
        <ul aria-label="Válvulas del catálogo" className="max-h-80 space-y-2 overflow-y-auto">
          {resultados.slice(0, MAXIMO_RESULTADOS).map((valvula) => (
            <li
              key={valvula.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{valvula.nombre}</p>
                <p className="text-xs break-words text-muted-foreground">
                  {[valvula.equipoNombre, valvula.plantaNombre, valvula.yacimientoNombre]
                    .filter(Boolean)
                    .join(" · ")}
                  {valvula.numeroSerie ? ` · N° de serie ${valvula.numeroSerie}` : ""}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                className="max-sm:w-full"
                aria-label={`Agregar ${valvula.nombre}`}
                disabled={agregar.isPending}
                onClick={() =>
                  agregar.mutate(valvula, {
                    onSuccess: (destino) => {
                      toast.success(avisoDeAlta(valvula.nombre, destino))
                      cerrar()
                    },
                  })
                }
              >
                Agregar
              </Button>
            </li>
          ))}
        </ul>
      )}
      {resultados.length > MAXIMO_RESULTADOS ? (
        <p className="text-xs text-muted-foreground">
          Se muestran {MAXIMO_RESULTADOS} de {resultados.length}. Escribí más para afinar la
          búsqueda.
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={cerrar} disabled={agregar.isPending}>
          Cancelar
        </Button>
      </DialogFooter>
    </div>
  )
}
