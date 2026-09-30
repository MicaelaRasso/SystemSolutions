"use client"

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query"
import { toast } from "sonner"

import { edgeApi } from "@/lib/api"
import { certificateQueryKeys } from "@/lib/api/certificates"
import { hierarchyInvalidations, hierarchyQueryKeys } from "@/lib/api/hierarchy"
import { operationQueryKeys } from "@/lib/api/operations"
import type {
  Adjunto,
  Certificado,
  ID,
  ListaCatalogo,
  Rol,
  Valvula,
  Yacimiento,
} from "@/lib/domain/types"
import { services, type FiltroTareas, type NuevaTarea, type TareaResumen } from "@/lib/services"

export const usaSupabase = () => true

export const qk = {
  empresas: (filtro?: object) => ["empresas", filtro ?? {}] as const,
  empresa: (id: ID) => ["empresa", id] as const,
  arbol: (empresaId: ID) => ["arbol", empresaId] as const,
  valvula: (id: ID) => ["valvula", id] as const,
  usuarios: (filtro?: object) => ["usuarios", filtro ?? {}] as const,
  accesos: (usuarioId: ID) => ["accesos", usuarioId] as const,
  certificadosValvula: (valvulaId: ID) => ["certificados", "valvula", valvulaId] as const,
  catalogo: (lista: ListaCatalogo) => ["catalogo", lista] as const,
  catalogoAdmin: (lista: ListaCatalogo) => ["catalogo-admin", lista] as const,
  catalogoResumen: () => ["catalogo-admin", "resumen"] as const,
  patrones: () => ["patrones"] as const,
  talleres: () => ["talleres"] as const,
  personas: () => ["personas"] as const,
  operaciones: (filtro?: FiltroTareas) => operationQueryKeys.list(operationFilters(filtro ?? {})),
  operacion: (id: ID) => operationQueryKeys.detail(id),
  tareas: (filtro?: FiltroTareas) => ["tareas", filtro ?? {}] as const,
  tarea: (id: ID) => ["tarea", id] as const,
  nominas: (desde: string, hasta: string) => ["nominas", desde, hasta] as const,
}

/** Prefijos a invalidar tras modificar un catálogo (formularios y administración). */
export const INVALIDAR_CATALOGOS = [["catalogo"], ["catalogo-admin"]]
/** Prefijos a invalidar tras modificar tareas o la proyección de operaciones. */
export const INVALIDAR_TAREAS = [["tareas"], ["tarea"], [...operationQueryKeys.all]]

export function invalidarEstructura(empresaId: ID): QueryKey[] {
  return usaSupabase() ? [...hierarchyInvalidations] : [qk.arbol(empresaId), ["empresas"]]
}

export function mensajeError(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado"
}

function toValvulaView(dto: Awaited<ReturnType<typeof edgeApi.valves.valve>>): Valvula {
  return {
    id: dto.valve.id,
    equipoId: dto.valve.equipo_id,
    tag: dto.valve.nombre,
    marca: dto.valve.marca ?? undefined,
    nroSerie: dto.valve.numero_serie ?? undefined,
    modelo: dto.valve.modelo ?? undefined,
    tipo: dto.valve.tipo ?? undefined,
    diamEntrada: dto.valve.diametro_entrada ?? undefined,
    diamSalida: dto.valve.diametro_salida ?? undefined,
    rosca: dto.valve.rosca ?? undefined,
  }
}

function toValveUpdateInput(
  data: Partial<Omit<Valvula, "id">>,
  current: Awaited<ReturnType<typeof edgeApi.valves.valve>>["valve"],
) {
  return {
    name: data.tag ?? current.nombre,
    marca: data.marca ?? current.marca,
    numero_serie: data.nroSerie ?? current.numero_serie,
    modelo: data.modelo ?? current.modelo,
    tipo: data.tipo ?? current.tipo,
    diametro_entrada: data.diamEntrada ?? current.diametro_entrada,
    clase_entrada: current.clase_entrada,
    diametro_salida: data.diamSalida ?? current.diametro_salida,
    clase_salida: current.clase_salida,
    rosca: data.rosca ?? current.rosca,
    razon_disponibilidad: current.razon_disponibilidad,
  }
}

function hasSupportedValveData(data: Partial<Omit<Valvula, "id">>) {
  return [
    data.marca,
    data.nroSerie,
    data.modelo,
    data.tipo,
    data.diamEntrada,
    data.diamSalida,
    data.rosca,
  ].some((value) => value !== undefined)
}

type TareaInput = NuevaTarea
export type OperationSummaryRead = Awaited<
  ReturnType<typeof edgeApi.operations.list>
>["items"][number]
export type OperationRead = Awaited<ReturnType<typeof edgeApi.operations.get>>
type ServiceRequest = Awaited<ReturnType<typeof edgeApi.serviceRequests.createRequest>>

function operationFilters(filtro: FiltroTareas) {
  return {
    from: filtro.desde,
    to: filtro.hasta,
    status: filtro.estados?.flatMap((estado) =>
      estado === "pendiente"
        ? ["solicitada" as const]
        : estado === "asignada"
          ? (["programada", "aceptada"] as const)
          : [estado],
    ),
    workshopId: filtro.tallerId === "sin_asignar" ? undefined : filtro.tallerId,
    clientId: filtro.empresaId,
    q: filtro.q,
  }
}

function serviceSelection(data: Pick<TareaInput, "equipoId" | "yacimientoId">) {
  return {
    yacimientoId: data.yacimientoId,
    selections: [{ kind: "equipo" as const, id: data.equipoId }],
  }
}

function visitWindow(date: string, time?: string) {
  const start = new Date(`${date}T${time || "08:00"}:00-03:00`)
  if (Number.isNaN(start.getTime())) throw new Error("La fecha de ejecución no es válida")
  return {
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
  }
}

function timeFromTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value))
}

function responseRequestId(response: ServiceRequest) {
  return response.request.id
}

async function solicitudIdDeOperacion(operationId: ID) {
  const visit = await edgeApi.visits.visit(operationId)
  const requestId = stringField(visit.visit, "solicitud_id", "request_id", "service_request_id")
  if (!requestId) throw new Error("La visita no informa la Solicitud de servicio asociada")
  return requestId
}

/** Canonical write path for the task screens. It never creates or updates an operation. */
export async function guardarSolicitudYVisita(
  operation: OperationRead | undefined,
  data: TareaInput,
): Promise<OperationRead | undefined> {
  const requestId = operation ? await solicitudIdDeOperacion(operation.operation.id) : undefined
  const context = operation ? undefined : await edgeApi.identity.context()
  const isAdministrator =
    context?.rol === "administrador_regular" || context?.rol === "super_administrador"
  const response = operation
    ? await edgeApi.serviceRequests.updateRequest(requestId!, serviceSelection(data))
    : isAdministrator
      ? await edgeApi.serviceRequests.createAdministrativeRequest({
          clientId: data.empresaId,
          ...serviceSelection(data),
        })
      : await edgeApi.serviceRequests.createRequest(serviceSelection(data))
  const canonicalRequestId = responseRequestId(response)

  if (!data.tallerId) {
    return undefined
  }

  const scheduled = await edgeApi.serviceWorkflow.schedule(canonicalRequestId, {
    tallerMovilId: data.tallerId,
    ...visitWindow(data.fechaEjecucion, data.horario),
  })
  const operationId = stringField(scheduled.visit, "id")
  return operationId ? edgeApi.operations.get(operationId) : undefined
}

export async function guardarTarea(tarea: TareaResumen | undefined, data: TareaInput) {
  if (usaSupabase()) throw new Error("Las tareas históricas se guardan como Solicitud de servicio")
  const saved = tarea
    ? await services.tareas.update(tarea.id, data)
    : await services.tareas.create(data)
  return services.tareas.get(saved.id)
}

export async function reasignarVisita(
  id: ID,
  tallerId: ID | undefined,
  fecha: string,
  horario?: string,
) {
  if (!tallerId) throw new Error("La desasignación de una visita no está disponible en esta API")
  const operation = await edgeApi.operations.get(id)
  const requestId = await solicitudIdDeOperacion(operation.operation.id)
  const scheduled = await edgeApi.serviceWorkflow.schedule(requestId, {
    tallerMovilId: tallerId,
    ...visitWindow(fecha, horario ?? timeFromTimestamp(operation.operation.starts_at)),
  })
  const operationId = stringField(scheduled.visit, "id")
  return operationId ? edgeApi.operations.get(operationId) : operation
}

export async function reasignarTarea(id: ID, tallerId: ID | undefined, fecha: string) {
  if (usaSupabase()) throw new Error("Las tareas históricas se reprograman como Visita de servicio")
  const saved = await services.tareas.update(id, {
    tallerId,
    fechaEjecucion: fecha,
  })
  return services.tareas.get(saved.id)
}

export async function cancelarVisita(id: ID) {
  await edgeApi.visits.transition(id, "cancel")
  return edgeApi.operations.get(id)
}

export async function cambiarEstadoTarea(id: ID, estado: "cancelada" | "pendiente") {
  if (!usaSupabase()) {
    const saved = await services.tareas.update(id, { estado })
    return services.tareas.get(saved.id)
  }
  if (estado === "pendiente")
    throw new Error("La reapertura de una visita no está disponible en esta API")
  return cancelarVisita(id)
}

export function subirAdjunto(archivo: File): Promise<Adjunto> {
  if (usaSupabase()) throw new Error("Los adjuntos de solicitudes no están disponibles en esta API")
  return services.tareas.subirAdjunto(archivo)
}

type EdgeCertificate = Awaited<
  ReturnType<typeof edgeApi.certificates.valveHistory>
>["certificates"][number]

function stringField(record: Record<string, unknown>, ...names: string[]) {
  const value = names.map((name) => record[name]).find((item) => typeof item === "string")
  return typeof value === "string" ? value : undefined
}

function numberField(record: Record<string, unknown>, ...names: string[]) {
  const value = names.map((name) => record[name]).find((item) => typeof item === "number")
  return typeof value === "number" ? value : undefined
}

function deletionUnavailable(): never {
  throw new Error("La eliminación de activos no está disponible en Supabase")
}

/** Keeps the history screen's established model while accepting the Edge row shape. */
function toCertificadoView(entry: EdgeCertificate): Certificado {
  const row = entry.certificate
  const fechaEjecucion =
    stringField(row, "fecha_ejecucion", "fechaEjecucion") ?? entry.validity?.execution_date ?? ""
  const id = row.id
  return {
    id,
    nro: numberField(row, "numero", "nro") ?? 0,
    localId: id,
    tareaId: stringField(row, "orden_trabajo_id", "tareaId") ?? "",
    tallerId: "",
    empresaId: "",
    yacimientoId: stringField(row, "yacimiento_id", "yacimientoId") ?? "",
    plantaId: stringField(row, "planta_id", "plantaId") ?? "",
    equipoId: stringField(row, "equipo_id", "equipoId") ?? "",
    valvulaId: stringField(row, "valvula_id", "valvulaId") ?? "",
    fechaEjecucion,
    emitidoEn: stringField(row, "created_at", "emitidoEn") ?? "",
    emitidoPor: "",
    valvula: {},
    alcance: [],
    repuestos: [],
    ensayos: {
      spInicial: { valor: 0, unidad: "" },
      spApertura: { valor: 0, unidad: "" },
      presionCierre: { valor: 0, unidad: "" },
      patronId: "",
      ejecuto: stringField(row, "tecnico_ejecutor") ?? "",
    },
    fotos: [],
    nomina: [],
    nombreArchivo: stringField(row, "nombre_archivo", "nombreArchivo") ?? "",
    revision: 0,
  }
}

async function actualizarValvula(id: ID, data: Partial<Omit<Valvula, "id">>) {
  if (!usaSupabase()) return services.estructura.updateValvula(id, data)
  const current = await edgeApi.valves.valve(id)
  return toValvulaView(
    await edgeApi.valves.updateValve(id, toValveUpdateInput(data, current.valve)),
  )
}

export const estructuraApi = {
  async arbol(empresaId: ID) {
    if (!usaSupabase()) return services.estructura.arbol(empresaId)
    const yacimientos = await edgeApi.yacimientos.listYacimientos()
    const accesibles = yacimientos.filter((yacimiento) => yacimiento.empresaId === empresaId)
    return Promise.all(accesibles.map((yacimiento) => edgeApi.yacimientos.tree(yacimiento.id)))
  },

  async createYacimiento(data: Omit<Yacimiento, "id">) {
    if (!usaSupabase()) return services.estructura.createYacimiento(data)
    return edgeApi.yacimientos.createYacimiento({
      clientId: data.empresaId,
      name: data.nombre,
      provincia: data.provincia,
      operadora: data.operadora,
      contratista: "No informado",
    })
  },

  async updateYacimiento(id: ID, data: Partial<Omit<Yacimiento, "id">>) {
    if (!usaSupabase()) return services.estructura.updateYacimiento(id, data)
    const current = await edgeApi.yacimientos.tree(id)
    return edgeApi.yacimientos.updateYacimiento(id, {
      name: data.nombre ?? current.nombre,
      provincia: data.provincia ?? current.provincia,
      operadora: data.operadora ?? current.operadora,
      contratista: current.contratista ?? "No informado",
    })
  },

  async createPlanta(data: { yacimientoId: ID; nombre: string }) {
    if (!usaSupabase()) return services.estructura.createPlanta(data)
    const planta = await edgeApi.yacimientos.createDescendant({
      kind: "planta",
      parentId: data.yacimientoId,
      name: data.nombre,
    })
    return { id: planta.id, yacimientoId: planta.yacimiento_id, nombre: planta.nombre }
  },

  async updatePlanta(id: ID, data: { nombre?: string }) {
    if (!usaSupabase()) return services.estructura.updatePlanta(id, data)
    const planta = await edgeApi.yacimientos.updateDescendant(id, {
      kind: "planta",
      name: data.nombre ?? "",
    })
    return { id: planta.id, yacimientoId: planta.yacimiento_id, nombre: planta.nombre }
  },

  async createEquipo(data: { plantaId: ID; nombre: string; descripcion?: string }) {
    if (!usaSupabase()) return services.estructura.createEquipo(data)
    const equipo = await edgeApi.yacimientos.createDescendant({
      kind: "equipo",
      parentId: data.plantaId,
      name: data.nombre,
    })
    return { id: equipo.id, plantaId: equipo.planta_id, nombre: equipo.nombre }
  },

  async updateEquipo(id: ID, data: { nombre?: string; descripcion?: string }) {
    if (!usaSupabase()) return services.estructura.updateEquipo(id, data)
    const equipo = await edgeApi.yacimientos.updateDescendant(id, {
      kind: "equipo",
      name: data.nombre ?? "",
    })
    return { id: equipo.id, plantaId: equipo.planta_id, nombre: equipo.nombre }
  },

  async getValvula(id: ID) {
    if (!usaSupabase()) return services.estructura.getValvula(id)
    return toValvulaView(await edgeApi.valves.valve(id))
  },

  async createValvula(data: Omit<Valvula, "id">) {
    if (!usaSupabase()) return services.estructura.createValvula(data)
    const valvula = await edgeApi.yacimientos.createDescendant({
      kind: "valvula",
      parentId: data.equipoId,
      name: data.tag,
    })
    return hasSupportedValveData(data)
      ? actualizarValvula(valvula.id, data)
      : { id: valvula.id, equipoId: valvula.equipo_id, tag: valvula.nombre }
  },

  updateValvula: actualizarValvula,

  deleteYacimiento: (id: ID) =>
    usaSupabase() ? deletionUnavailable() : services.estructura.deleteYacimiento(id),
  deletePlanta: (id: ID) =>
    usaSupabase() ? deletionUnavailable() : services.estructura.deletePlanta(id),
  deleteEquipo: (id: ID) =>
    usaSupabase() ? deletionUnavailable() : services.estructura.deleteEquipo(id),
  deleteValvula: (id: ID) =>
    usaSupabase() ? deletionUnavailable() : services.estructura.deleteValvula(id),

  listCertificadosPorValvula: async (id: ID) => {
    if (!usaSupabase()) return services.certificados.listPorValvula(id)
    return (await edgeApi.certificates.valveHistory(id)).certificates.map(toCertificadoView)
  },
}

/**
 * Mutación con toast de éxito/error e invalidación de queries.
 * `invalidar` recibe prefijos: ["empresas"] invalida todas las listas de empresas.
 */
export function useServiceMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opciones: { exito?: string; invalidar?: QueryKey[] } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        (opciones.invalidar ?? []).map((k) => qc.invalidateQueries({ queryKey: k })),
      )
      if (opciones.exito) toast.success(opciones.exito)
    },
    onError: (error) => toast.error(mensajeError(error)),
  })
}

export const useEmpresas = (filtro: { q?: string; incluirInactivas?: boolean } = {}) =>
  useQuery({ queryKey: qk.empresas(filtro), queryFn: () => services.empresas.list(filtro) })

export const useEmpresa = (id: ID) =>
  useQuery({ queryKey: qk.empresa(id), queryFn: () => services.empresas.get(id) })

export const useArbol = (empresaId: ID) =>
  useQuery({
    queryKey: usaSupabase() ? hierarchyQueryKeys.tree(empresaId) : qk.arbol(empresaId),
    queryFn: () => estructuraApi.arbol(empresaId),
    enabled: !!empresaId,
  })

export const useValvula = (valvulaId: ID | undefined) =>
  useQuery({
    queryKey: usaSupabase()
      ? hierarchyQueryKeys.valve(valvulaId ?? "")
      : qk.valvula(valvulaId ?? ""),
    queryFn: () => estructuraApi.getValvula(valvulaId!),
    enabled: Boolean(valvulaId) && usaSupabase(),
  })

export const useUsuarios = (filtro: { rol?: Rol; empresaId?: ID } = {}) =>
  useQuery({ queryKey: qk.usuarios(filtro), queryFn: () => services.usuarios.list(filtro) })

export const useAccesos = (usuarioId: ID | undefined) =>
  useQuery({
    queryKey: qk.accesos(usuarioId ?? ""),
    queryFn: () => services.usuarios.getAccesos(usuarioId!),
    enabled: !!usuarioId,
  })

export const useCertificadosValvula = (valvulaId: ID | undefined) =>
  useQuery({
    queryKey: usaSupabase()
      ? certificateQueryKeys.valveHistory(valvulaId ?? "")
      : qk.certificadosValvula(valvulaId ?? ""),
    queryFn: () => estructuraApi.listCertificadosPorValvula(valvulaId!),
    enabled: !!valvulaId,
  })

export const useCatalogo = (lista: ListaCatalogo) =>
  useQuery({
    queryKey: qk.catalogo(lista),
    queryFn: () => services.catalogos.opciones(lista),
    staleTime: 5 * 60_000,
  })

export const useCatalogoAdmin = (lista: ListaCatalogo) =>
  useQuery({ queryKey: qk.catalogoAdmin(lista), queryFn: () => services.catalogos.listar(lista) })

export const useCatalogoResumen = () =>
  useQuery({ queryKey: qk.catalogoResumen(), queryFn: () => services.catalogos.resumen() })

export const usePatrones = () =>
  useQuery({ queryKey: qk.patrones(), queryFn: () => services.patrones.list() })

export const useTalleres = () =>
  useQuery({ queryKey: qk.talleres(), queryFn: () => services.talleres.list() })

export const usePersonas = () =>
  useQuery({ queryKey: qk.personas(), queryFn: () => services.personas.list() })

export const useOperaciones = (filtro: FiltroTareas = {}) =>
  useQuery({
    queryKey: qk.operaciones(filtro),
    queryFn: async () => (await edgeApi.operations.list(operationFilters(filtro))).items,
    enabled: usaSupabase(),
    placeholderData: (prev) => prev,
  })

export const useOperacion = (id: ID) =>
  useQuery({
    queryKey: qk.operacion(id),
    queryFn: () => edgeApi.operations.get(id),
    enabled: Boolean(id) && usaSupabase(),
  })

export const useTareas = (filtro: FiltroTareas = {}) =>
  useQuery({
    queryKey: qk.tareas(filtro),
    queryFn: () => services.tareas.list(filtro),
    enabled: !usaSupabase(),
    placeholderData: (prev) => prev,
  })

export const useTarea = (id: ID) =>
  useQuery({
    queryKey: qk.tarea(id),
    queryFn: () => services.tareas.get(id),
    enabled: Boolean(id) && !usaSupabase(),
  })

export const useNominas = (desde: string, hasta: string) =>
  useQuery({
    queryKey: qk.nominas(desde, hasta),
    queryFn: () => services.cronograma.nominas(desde, hasta),
    placeholderData: (prev) => prev,
  })
