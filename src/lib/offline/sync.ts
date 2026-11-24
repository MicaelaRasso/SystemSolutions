import type { CertificateCaptureCatalogsDto } from "../api/contracts"
import { traducirMensajeError } from "../domain/errores"

export const OFFLINE_SCHEMA_VERSION = 2

/** Mensaje crudo del backend cuando ya existe una firma de esa parte para la visita. */
const FIRMA_YA_REGISTRADA = "A visit signature cannot be replaced"

/**
 * Indica si un error (o su mensaje) dice que la firma de la visita ya está registrada en el
 * servidor. Reconoce el mensaje crudo en inglés y su traducción al español.
 */
export function esFirmaYaRegistrada(error: unknown): boolean {
  const mensaje =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined
  if (!mensaje) return false
  return (
    mensaje.includes(FIRMA_YA_REGISTRADA) ||
    mensaje.includes(traducirMensajeError(FIRMA_YA_REGISTRADA))
  )
}

/**
 * Motivo crudo del backend cuando una operación llega después del cierre automático de la visita
 * (E3, #96): la visita quedó en «Requiere finalización» y la operación pasa a conflicto para el
 * Administrador.
 */
export const MOTIVO_VISITA_VENCIDA =
  "The visit was closed at the end of its day and requires finalization"

/** Indica si un error (o su mensaje) dice que la visita venció y requiere finalización. */
export function esVisitaVencida(error: unknown): boolean {
  const mensaje =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined
  if (!mensaje) return false
  return (
    mensaje.includes(MOTIVO_VISITA_VENCIDA) ||
    mensaje.includes(traducirMensajeError(MOTIVO_VISITA_VENCIDA))
  )
}

/** Estado del recibo de una firma local que el servidor ya tenía registrada. */
export const RECIBO_FIRMA_YA_REGISTRADA = "ya_registrada"

export type EstadoOperacionLocal =
  | "guardada_local"
  | "sincronizando"
  | "sincronizada"
  | "conflicto"
  | "fallida"
  | "bloqueada"

export type EstadoLocalVisita = "disponible" | "en_curso_local" | "completada_local"

export interface OperacionOffline {
  operationId: string
  idempotencyKey?: string
  visitId: string
  kind: string
  payload: Record<string, unknown>
  dependencies: string[]
  baseVersions?: Record<string, number>
  schemaVersion: number
  createdAt: string
  deviceTimestamp?: string
  deviceId: string
  estado: EstadoOperacionLocal
  attempts: number
  nextRetryAt?: string
  lastError?: string
  mediaIds?: string[]
  receipt?: {
    serverStatus: string
    serverResult?: unknown
    serverReceivedAt?: string
    acknowledgedAt: string
  }
}

export interface VisitaOffline {
  id: string
  context: unknown
  pinnedCertificateCatalogs?: PinnedCertificateCatalogs
  cachedAt: string
  cachedVersion?: number
  backendStatus?: string
  estadoLocal: EstadoLocalVisita
  synchronizationPending: boolean
  visitAcknowledgement?: VisitAcknowledgement
  claimedByDeviceId?: string
  claimedAt?: string
}

export interface PinnedCertificateCatalogs {
  replacementCatalogVersion: string
  replacementParts: CertificateCaptureCatalogsDto["replacement_parts"]
}

export interface MediaOffline {
  id: string
  visitId: string
  operationId?: string
  kind: "photo" | "signature"
  section?: string
  file?: Blob
  blob?: Blob
  fileName?: string
  contentType?: string
  createdAt: string
}
export type OfflineMedia = MediaOffline & { mediaId?: string }

export interface VisitAcknowledgement {
  visit_id: string
  estado: "sincronizada" | "conflicto" | "pendiente"
  server_received_at: string
  server_acknowledged_at: string
  [key: string]: unknown
}

export interface ResultadoOperacionServidor {
  operation_id: string
  estado: "sincronizada" | "conflicto" | "pendiente"
  result?: unknown
  error_code?: string
  error_message?: string
  server_received_at?: string
  server_acknowledged_at?: string
}

export interface OfflineStore {
  getOperation(operationId: string): Promise<OperacionOffline | undefined>
  listOperations(visitId: string): Promise<OperacionOffline[]>
  saveOperation(operation: OperacionOffline): Promise<void>
  saveVisit(visit: VisitaOffline): Promise<void>
  getVisit(visitId: string): Promise<VisitaOffline | undefined>
  removeOperationPayload(operationId: string, receipt: OperacionOffline["receipt"]): Promise<void>
  saveMedia?(media: OfflineMedia): Promise<void>
  getMedia?(mediaId: string): Promise<OfflineMedia | undefined>
  removeMedia?(mediaId: string): Promise<void>
  deleteMedia?(mediaId: string): Promise<void>
}

export interface WorkingSetStore extends OfflineStore {
  listVisits(): Promise<VisitaOffline[]>
  deleteVisit(visitId: string): Promise<void>
  removeVisit?(visitId: string): Promise<void>
}

type VisitContextWithCatalogs = {
  certificate_catalogs?: CertificateCaptureCatalogsDto
  visit?: { estado?: string }
}

const visitContext = (context: unknown): VisitContextWithCatalogs | undefined =>
  context && typeof context === "object" && !Array.isArray(context)
    ? (context as VisitContextWithCatalogs)
    : undefined

const pinnedCatalogsFrom = (
  catalogs: CertificateCaptureCatalogsDto | undefined,
): PinnedCertificateCatalogs | undefined =>
  catalogs
    ? {
        replacementCatalogVersion: catalogs.replacement_catalog_version,
        replacementParts: catalogs.replacement_parts.map(({ id, label }) => ({ id, label })),
      }
    : undefined

export function pinVisitCertificateCatalogs(
  visit: VisitaOffline,
  catalogs?: CertificateCaptureCatalogsDto,
): VisitaOffline {
  if (visit.pinnedCertificateCatalogs) return visit
  const available = catalogs ?? visitContext(visit.context)?.certificate_catalogs
  const snapshot = pinnedCatalogsFrom(available)
  if (!snapshot)
    throw new Error("No hay un catálogo de repuestos descargado para iniciar la Visita de servicio")
  return { ...visit, pinnedCertificateCatalogs: snapshot }
}

export function certificateCatalogsForVisit(
  visit: VisitaOffline,
  fallback?: CertificateCaptureCatalogsDto,
): CertificateCaptureCatalogsDto | undefined {
  const base = visitContext(visit.context)?.certificate_catalogs ?? fallback
  if (!base || !visit.pinnedCertificateCatalogs) return base
  return {
    ...base,
    replacement_catalog_version: visit.pinnedCertificateCatalogs.replacementCatalogVersion,
    replacement_parts: visit.pinnedCertificateCatalogs.replacementParts,
  }
}

export function refreshedVisitCatalogs(input: {
  previous?: VisitaOffline
  refreshedContext: unknown
  refreshedCatalogs?: CertificateCaptureCatalogsDto
}): Pick<VisitaOffline, "context" | "pinnedCertificateCatalogs"> {
  const previousContext = visitContext(input.previous?.context)
  const refreshed = visitContext(input.refreshedContext) ?? {}
  const backendWasStarted = input.previous?.backendStatus === "en_curso"
  const serverStarted = backendWasStarted || refreshed.visit?.estado === "en_curso"
  let pinned = input.previous?.pinnedCertificateCatalogs

  if (!pinned && input.previous?.estadoLocal === "en_curso_local") {
    pinned = pinnedCatalogsFrom(previousContext?.certificate_catalogs)
  }
  if (!pinned && serverStarted) {
    const source = backendWasStarted
      ? previousContext?.certificate_catalogs
      : refreshed.certificate_catalogs ?? input.refreshedCatalogs
    pinned = pinnedCatalogsFrom(source)
  }

  const catalogs = input.refreshedCatalogs ?? refreshed.certificate_catalogs
  const availableCatalogs = pinned
    ? {
        ...(catalogs ?? previousContext?.certificate_catalogs),
        replacement_catalog_version: pinned.replacementCatalogVersion,
        replacement_parts: pinned.replacementParts,
      }
    : catalogs ?? previousContext?.certificate_catalogs

  return {
    context: {
      ...(input.refreshedContext && typeof input.refreshedContext === "object"
        ? (input.refreshedContext as Record<string, unknown>)
        : {}),
      ...(availableCatalogs ? { certificate_catalogs: availableCatalogs } : {}),
    },
    pinnedCertificateCatalogs: pinned,
  }
}

/**
 * Antes de descargar un working set nuevo se sincronizan los inicios offline pendientes (y los
 * cierres pendientes, que liberan al taller). Un Taller Móvil atiende una visita a la vez y el
 * servidor rechaza iniciar otra mientras una sigue en curso, así que las visitas se envían en el
 * orden en que se trabajaron: primero la que tiene el inicio o el cierre pendiente más antiguo.
 * Así, «completé A y empecé B sin conexión» llega como A completada y después B iniciada.
 *
 * Si un inicio no se pudo confirmar (sin respuesta o con error transitorio) se corta el refresco
 * para no cambiar el catálogo antes de fijarlo. Un inicio que quedó en conflicto ya está en manos
 * del Administrador (reintentarlo no lo cambia) y no bloquea el refresco.
 */
export async function syncPendingVisitStartsBeforeRefresh(
  store: WorkingSetStore,
  syncVisit: (visitId: string) => Promise<OperacionOffline[]>,
): Promise<void> {
  const visits = await store.listVisits()
  const pendientes: { visitId: string; desde: string; inicios: OperacionOffline[] }[] = []
  for (const visit of visits) {
    const operations = await store.listOperations(visit.id)
    const sinSincronizar = operations.filter(
      (operation) =>
        (operation.kind === "start_visit" || operation.kind === "complete_visit") &&
        operation.estado !== "sincronizada" &&
        operation.estado !== "conflicto",
    )
    if (sinSincronizar.length === 0) continue
    pendientes.push({
      visitId: visit.id,
      desde: sinSincronizar.map((operation) => operation.createdAt).sort()[0],
      inicios: sinSincronizar.filter((operation) => operation.kind === "start_visit"),
    })
  }
  pendientes.sort((a, b) => a.desde.localeCompare(b.desde) || a.visitId.localeCompare(b.visitId))
  for (const { visitId, inicios } of pendientes) {
    const remaining = await syncVisit(visitId)
    for (const operation of inicios) {
      const result = remaining.find(({ operationId }) => operationId === operation.operationId)
      if (result?.estado !== "sincronizada" && result?.estado !== "conflicto")
        throw new Error("No se pudo confirmar el inicio offline antes de descargar el catálogo")
    }
  }
}

export interface SyncTransport {
  syncVisit(
    visitId: string,
    operations: unknown[],
    deviceId: string,
  ): Promise<{
    operations: ResultadoOperacionServidor[]
    visit_acknowledgement?: VisitAcknowledgement
  }>
  claimVisit?(visitId: string, deviceId: string): Promise<{
    visit_id: string
    device_id: string
    claimed_at: string
    last_seen_at: string
  }>
  uploadMedia?(input: {
    visitId: string
    deviceId: string
    operationId: string
    mediaId: string
    kind: "photo" | "signature"
    party?: "tecnico" | "cliente"
    category?: string
    file: Blob
    fileName?: string
  }): Promise<{
    media_id: string
    image_id: string
    bucket: string
    object_path: string
    content_type: string
    server_received_at: string
  }>
}

export interface OfflineClock {
  now(): string
  id(): string
}

const systemClock: OfflineClock = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
}

const editableAfterCompletion = new Set([
  "start_certificate_draft",
  "update_certificate_draft",
  "capture_evidence",
  "upload_evidence",
  "upload_photo",
  "set_part_diario",
  "attach_part_diario_image",
])

const retryDelayMs = (attempts: number) =>
  Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, attempts - 1))

const isDue = (operation: OperacionOffline, now: string) =>
  !operation.nextRetryAt || operation.nextRetryAt <= now

const mediaOperationKinds = new Set([
  "capture_evidence",
  "upload_evidence",
  "upload_photo",
  "submit_signature",
  "attach_part_diario_image",
])

const hasUploadedReference = (payload: Record<string, unknown>) =>
  typeof payload.object_path === "string" &&
  payload.object_path.length > 0 &&
  typeof payload.image_id === "string" &&
  payload.image_id.length > 0

/** Referencia de Storage con la que el servidor registra una foto de evidencia del certificado. */
export type ReferenciaEvidencia = { image_id: string; bucket: string; object_path: string }

const esRegistro = (valor: unknown): valor is Record<string, unknown> =>
  !!valor && typeof valor === "object" && !Array.isArray(valor)

const esReferenciaEvidencia = (valor: unknown): valor is ReferenciaEvidencia =>
  esRegistro(valor) &&
  typeof valor.image_id === "string" &&
  valor.image_id.length > 0 &&
  typeof valor.bucket === "string" &&
  valor.bucket.length > 0 &&
  typeof valor.object_path === "string" &&
  valor.object_path.length > 0

/**
 * Referencias de Storage ya conocidas para las fotos locales, por `media_id` (que es el mismo
 * `image_id` del servidor). Salen de las operaciones cuyo archivo ya se subió y de los recibos de
 * las ya sincronizadas (resultado directo o la evidencia del certificado devuelto).
 */
export function referenciasDeEvidencia(
  operations: OperacionOffline[],
): Map<string, ReferenciaEvidencia> {
  const referencias = new Map<string, ReferenciaEvidencia>()
  const agregar = (valor: unknown, mediaId?: unknown) => {
    if (!esReferenciaEvidencia(valor)) return
    const referencia = {
      image_id: valor.image_id,
      bucket: valor.bucket,
      object_path: valor.object_path,
    }
    referencias.set(valor.image_id, referencia)
    if (typeof mediaId === "string" && mediaId.length > 0) referencias.set(mediaId, referencia)
  }
  for (const operation of operations) {
    agregar(operation.payload, operation.payload.media_id)
    const resultado = operation.receipt?.serverResult
    if (!esRegistro(resultado)) continue
    agregar(resultado, resultado.media_id)
    const certificado = resultado.certificate
    if (esRegistro(certificado) && esRegistro(certificado.evidencia_fotografica))
      for (const valor of Object.values(certificado.evidencia_fotografica)) agregar(valor)
  }
  return referencias
}

/**
 * Reemplaza en la evidencia del certificado las fotos `{ media_id }` que el servidor ya registró
 * por su referencia `{ image_id, bucket, object_path }`. Así un borrador guardado después de
 * sincronizar no pisa la referencia registrada con el identificador local (P2).
 */
export function resolverEvidencia<T>(evidencia: T, referencias: Map<string, ReferenciaEvidencia>): T {
  if (!esRegistro(evidencia) || referencias.size === 0) return evidencia
  return Object.fromEntries(
    Object.entries(evidencia).map(([seccion, valor]) => {
      const mediaId =
        esRegistro(valor) && !esReferenciaEvidencia(valor) && typeof valor.media_id === "string"
          ? valor.media_id
          : undefined
      return [seccion, (mediaId && referencias.get(mediaId)) || valor]
    }),
  ) as T
}

/** Aplica `resolverEvidencia` a los datos de un guardado de borrador (`{ evidencia_fotografica }`). */
export function resolverEvidenciaDelBorrador<T extends object>(
  datos: T,
  referencias: Map<string, ReferenciaEvidencia>,
): T {
  const actual = (datos as Record<string, unknown>).evidencia_fotografica
  if (actual === undefined) return datos
  const evidencia = resolverEvidencia(actual, referencias)
  return evidencia === actual ? datos : { ...datos, evidencia_fotografica: evidencia }
}

/**
 * Operaciones que agregan una Orden de trabajo a la visita desde el campo (A1/A2). El payload lleva
 * `work_order_id` (generado en el dispositivo) y `valvula` con los datos para mostrarla offline.
 */
export const OPERACIONES_ALTA_DE_ORDEN: ReadonlySet<string> = new Set([
  "add_work_order",
  "create_valve",
])

/** Orden de trabajo agregada en el dispositivo que el servidor todavía no devolvió. */
export interface OrdenAgregadaLocal {
  id: string
  visita_id: string
  valvula_id: string
  estado: "pendiente"
  no_evaluada_razon: null
  valvula_nombre?: string
  equipo_nombre?: string
  valvula?: Record<string, unknown>
  alta_local: true
}

/** Orden que devolvió el servidor al sincronizar el alta (recibo de la operación). */
export type OrdenDelRecibo = { id: string } & Record<string, unknown>

const textoOpcional = (valor: unknown) =>
  typeof valor === "string" && valor.trim() !== "" ? valor.trim() : undefined

/**
 * Órdenes de la visita más las agregadas en el dispositivo (alta optimista). Las que el servidor ya
 * devuelve no se repiten; las que quedaron en conflicto no se muestran (las resuelve el
 * Administrador). Una alta sincronizada cuyo payload se compactó se arma con el recibo.
 */
export function ordenesConAltasLocales<T extends { id: string }>(
  ordenes: T[],
  operaciones: OperacionOffline[],
): Array<T | OrdenAgregadaLocal | OrdenDelRecibo> {
  const ids = new Set(ordenes.map((orden) => orden.id))
  const agregadas: Array<OrdenAgregadaLocal | OrdenDelRecibo> = []
  const altas = operaciones
    .filter(
      (operacion) => OPERACIONES_ALTA_DE_ORDEN.has(operacion.kind) && operacion.estado !== "conflicto",
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId))
  for (const operacion of altas) {
    if (operacion.estado === "sincronizada") {
      const resultado = operacion.receipt?.serverResult
      const orden = esRegistro(resultado) ? resultado.work_order : undefined
      if (!esRegistro(orden) || typeof orden.id !== "string" || ids.has(orden.id)) continue
      ids.add(orden.id)
      agregadas.push(orden as OrdenDelRecibo)
      continue
    }
    const { work_order_id: id, valvula_id: valvulaId, valvula } = operacion.payload
    if (typeof id !== "string" || typeof valvulaId !== "string" || ids.has(id)) continue
    ids.add(id)
    const datosValvula = esRegistro(valvula) ? valvula : undefined
    agregadas.push({
      id,
      visita_id: operacion.visitId,
      valvula_id: valvulaId,
      estado: "pendiente",
      no_evaluada_razon: null,
      valvula_nombre:
        textoOpcional(operacion.payload.valvula_nombre) ?? textoOpcional(datosValvula?.nombre),
      equipo_nombre: textoOpcional(operacion.payload.equipo_nombre),
      valvula: datosValvula
        ? {
            id: valvulaId,
            // `create_valve` lleva el equipo elegido aparte de los datos de la válvula.
            ...(typeof operacion.payload.equipo_id === "string"
              ? { equipo_id: operacion.payload.equipo_id }
              : {}),
            ...datosValvula,
          }
        : undefined,
      alta_local: true,
    })
  }
  return [...ordenes, ...agregadas]
}

/**
 * Operaciones de alta todavía no sincronizadas de una orden: lo que se encole sobre esa orden
 * (resultado, borrador) tiene que esperar a que el servidor la cree.
 */
export function dependenciasDeOrden(operaciones: OperacionOffline[], workOrderId: string): string[] {
  return operaciones
    .filter(
      (operacion) =>
        OPERACIONES_ALTA_DE_ORDEN.has(operacion.kind) &&
        operacion.estado !== "sincronizada" &&
        operacion.payload.work_order_id === workOrderId,
    )
    .map((operacion) => operacion.operationId)
}

export const migratePendingOperation = (operation: OperacionOffline): OperacionOffline => {
  if (operation.schemaVersion > OFFLINE_SCHEMA_VERSION) {
    return { ...operation, estado: "bloqueada", lastError: "Versión de operación no compatible" }
  }
  if (operation.schemaVersion === OFFLINE_SCHEMA_VERSION) return operation
  return {
    ...operation,
    schemaVersion: OFFLINE_SCHEMA_VERSION,
    idempotencyKey: operation.idempotencyKey ?? operation.operationId,
    deviceTimestamp: operation.deviceTimestamp ?? operation.createdAt,
  }
}

export const reconcileWorkingSet = async (
  store: WorkingSetStore,
  workingSet: {
    certificate_catalogs?: CertificateCaptureCatalogsDto
    visits: Array<{
      visit: Record<string, unknown>
      work_orders: unknown[]
      context: unknown
      certificate_catalogs?: CertificateCaptureCatalogsDto
    }>
  },
  clock: OfflineClock = systemClock,
) => {
  const serverVisits = new Set(workingSet.visits.map((entry) => String(entry.visit.id)))
  const localVisits = await store.listVisits()

  for (const entry of workingSet.visits) {
    const visitId = String(entry.visit.id)
    const existing = await store.getVisit(visitId)
    const localOperations = await store.listOperations(visitId)
    const pending = localOperations.some((operation) => operation.estado !== "sincronizada")
    const catalogs = entry.certificate_catalogs ?? workingSet.certificate_catalogs
    const catalogState = refreshedVisitCatalogs({
      previous: existing,
      refreshedContext: { ...entry, certificate_catalogs: catalogs },
      refreshedCatalogs: catalogs,
    })
    await store.saveVisit({
      id: visitId,
      ...catalogState,
      cachedAt: clock.now(),
      cachedVersion: Number(entry.visit.sync_version) || undefined,
      backendStatus: String(entry.visit.estado ?? existing?.backendStatus ?? ""),
      estadoLocal: existing?.estadoLocal ?? "disponible",
      synchronizationPending: pending,
      visitAcknowledgement: existing?.visitAcknowledgement,
      claimedByDeviceId: existing?.claimedByDeviceId,
      claimedAt: existing?.claimedAt,
    })
  }

  for (const local of localVisits) {
    if (serverVisits.has(local.id)) continue
    const operations = await store.listOperations(local.id)
    if (!operations.some((operation) => operation.estado !== "sincronizada"))
      await store.deleteVisit(local.id)
  }
}

export const hydrateWorkingSet = reconcileWorkingSet

export async function queueOfflineSignatureCapture(input: {
  store: OfflineStore
  coordinator: OfflineSyncCoordinator
  visitId: string
  deviceId: string
  party: "tecnico" | "cliente"
  signerName: string
  file: Blob
  mediaId?: string
  dependencies?: string[]
}) {
  if (!input.store.saveMedia) throw new Error("El almacenamiento offline de medios no está disponible")
  const mediaId = input.mediaId ?? crypto.randomUUID()
  await input.store.saveMedia({
    id: mediaId,
    mediaId,
    visitId: input.visitId,
    kind: "signature",
    blob: input.file,
    file: input.file,
    contentType: input.file.type,
    fileName: input.file instanceof File ? input.file.name : `firma-${mediaId}.png`,
    createdAt: new Date().toISOString(),
  })
  const mediaOperation = await input.coordinator.queue(
    input.visitId,
    input.deviceId,
    "upload_evidence",
    {
      media_id: mediaId,
      category: `firma_${input.party}`,
      content_type: input.file.type,
    },
    input.dependencies ?? [],
    { mediaIds: [mediaId] },
  )
  const signatureOperation = await input.coordinator.queue(
    input.visitId,
    input.deviceId,
    "submit_signature",
    {
      party: input.party,
      signer_name: input.signerName,
      image_id: mediaId,
      media_id: mediaId,
      capture_method: input.party === "tecnico" ? "pwa_tecnico" : "pwa_cliente_presencial",
    },
    [...(input.dependencies ?? []), mediaOperation.operationId],
  )
  return { mediaId, mediaOperation, signatureOperation }
}

/**
 * La dependencia ya no frena a las operaciones que la siguen: se sincronizó, o quedó en conflicto
 * porque la visita venció (E3). En ese caso todo lo hecho sin conexión tiene que llegar al servidor
 * para quedar también en conflicto y que el Administrador lo acepte en orden; si no, el resto
 * (resultados, firmas, completar) quedaba en el dispositivo y el Administrador solo veía el inicio.
 */
function dependenciaResuelta(operation: OperacionOffline): boolean {
  return (
    operation.estado === "sincronizada" ||
    (operation.estado === "conflicto" && esVisitaVencida(operation.lastError))
  )
}

/** Última sincronización encolada de cada visita (compartida por todos los coordinadores). */
const sincronizacionesPorVisita = new Map<string, Promise<void>>()

export class OfflineSyncCoordinator {
  constructor(
    private readonly store: OfflineStore,
    private readonly transport: SyncTransport,
    private readonly clock: OfflineClock = systemClock,
  ) {}

  async queue(
    visitId: string,
    deviceId: string,
    kind: string,
    payload: Record<string, unknown>,
    dependencies: string[] = [],
    options: {
      baseVersions?: Record<string, number>
      mediaIds?: string[]
      idempotencyKey?: string
    } = {},
  ): Promise<OperacionOffline> {
    const visit = await this.store.getVisit(visitId)
    if (visit?.estadoLocal === "completada_local" && editableAfterCompletion.has(kind)) {
      throw new Error("La Visita de servicio está completada localmente y el borrador está cerrado")
    }
    const operationId = this.clock.id()
    const createdAt = this.clock.now()
    const operation: OperacionOffline = {
      operationId,
      idempotencyKey: options.idempotencyKey ?? operationId,
      visitId,
      kind,
      payload,
      dependencies,
      baseVersions: options.baseVersions,
      schemaVersion: OFFLINE_SCHEMA_VERSION,
      createdAt,
      deviceTimestamp: createdAt,
      deviceId,
      estado: "guardada_local",
      attempts: 0,
      mediaIds:
        options.mediaIds ??
        [payload.media_id, payload.image_id]
          .filter((value): value is string => typeof value === "string" && value.length > 0),
    }
    await this.store.saveOperation(operation)
    if (visit) {
      visit.synchronizationPending = true
      await this.store.saveVisit(visit)
    }
    return operation
  }

  async markVisitLocallyComplete(visitId: string): Promise<void> {
    const visit = await this.store.getVisit(visitId)
    if (!visit) throw new Error("La Visita de servicio no está disponible en el dispositivo")
    visit.estadoLocal = "completada_local"
    visit.synchronizationPending = true
    await this.store.saveVisit(visit)
  }

  /**
   * Registra en el dispositivo que el servidor ya completó la visita. La visita completada sale de
   * la agenda de campo y el refresco no vuelve a actualizarla: sin esto, si le quedaba algún cambio
   * local, seguía con el último estado descargado (`en_curso`) y bloqueaba el inicio de la
   * siguiente visita del taller.
   */
  async markVisitCompletedOnServer(visitId: string): Promise<void> {
    const visit = await this.store.getVisit(visitId)
    if (!visit) return
    visit.backendStatus = "completada"
    await this.store.saveVisit(visit)
  }

  async claimVisit(visitId: string, deviceId: string): Promise<VisitaOffline> {
    const visit = await this.store.getVisit(visitId)
    if (!visit) throw new Error("La Visita de servicio no está disponible en el dispositivo")
    if (visit.claimedByDeviceId && visit.claimedByDeviceId !== deviceId)
      throw new Error("Esta Visita de servicio ya está siendo trabajada en otro dispositivo")
    if (this.transport.claimVisit) {
      const claim = await this.transport.claimVisit(visitId, deviceId)
      visit.claimedAt = claim.claimed_at
    } else if (visit.claimedByDeviceId !== deviceId) {
      await this.transport.syncVisit(visitId, [], deviceId)
      visit.claimedAt = this.clock.now()
    }
    visit.claimedByDeviceId = deviceId
    await this.store.saveVisit(visit)
    return visit
  }

  /**
   * Sincroniza las operaciones de la visita. Las sincronizaciones de una misma visita se encolan
   * (también entre coordinadores distintos: el panel crea uno por refresco): dos lotes en paralelo
   * leían copias viejas de las operaciones y una pisaba el recibo de la otra, dejando como
   * «fallida» una operación ya registrada. Se reenviaba después del cierre, el servidor rechazaba
   * el lote («Only an active visit can be claimed») y la visita seguía figurando en curso.
   */
  async sync(
    visitId: string,
    deviceId: string,
    options: { respectBackoff?: boolean } = {},
  ): Promise<OperacionOffline[]> {
    const previa = sincronizacionesPorVisita.get(visitId) ?? Promise.resolve()
    const actual = previa.then(() => this.syncExclusivo(visitId, deviceId, options))
    const cola = actual.then(
      () => undefined,
      () => undefined,
    )
    sincronizacionesPorVisita.set(visitId, cola)
    try {
      return await actual
    } finally {
      if (sincronizacionesPorVisita.get(visitId) === cola) sincronizacionesPorVisita.delete(visitId)
    }
  }

  private async syncExclusivo(
    visitId: string,
    deviceId: string,
    options: { respectBackoff?: boolean },
  ): Promise<OperacionOffline[]> {
    const now = this.clock.now()
    const initial = (await this.store.listOperations(visitId)).map(migratePendingOperation)
    for (const operation of initial) await this.store.saveOperation(operation)

    for (const operation of initial) {
      if (operation.estado === "sincronizando") {
        operation.estado = "fallida"
        operation.lastError = "Sincronización interrumpida; se reintentará con la misma operación"
        await this.store.saveOperation(operation)
      }
    }

    // Una firma que el servidor ya tenía registrada no se puede reemplazar: se da por sincronizada
    // para que no trabe al resto (por ejemplo, el cierre de la visita encolado detrás).
    for (const operation of initial) {
      if (
        operation.kind === "submit_signature" &&
        (operation.estado === "fallida" || operation.estado === "conflicto") &&
        esFirmaYaRegistrada(operation.lastError)
      )
        await this.marcarFirmaYaRegistrada(operation)
    }

    const attempted = new Set<string>()
    // Si el servidor rechaza un lote entero por una firma repetida, se reintenta de a una operación
    // para identificarla sin perder las demás.
    let aislar = false
    for (let layer = 0; layer <= initial.length; layer += 1) {
      const current = (await this.store.listOperations(visitId)).map(migratePendingOperation)
      const ready = current
        .filter(
          (operation) =>
            (operation.estado === "guardada_local" || operation.estado === "fallida") &&
            !attempted.has(operation.operationId) &&
            (!options.respectBackoff || isDue(operation, now)) &&
            operation.dependencies.every((dependency) =>
              current.some(
                (candidate) => candidate.operationId === dependency && dependenciaResuelta(candidate),
              ),
            ),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId))
      if (aislar) ready.splice(1)
      if (ready.length === 0) break

      for (const operation of ready) {
        attempted.add(operation.operationId)
        operation.estado = "sincronizando"
        operation.attempts += 1
        delete operation.lastError
        await this.store.saveOperation(operation)
      }

      const sendable: OperacionOffline[] = []
      let firmaResueltaEnSubida = false
      for (const operation of ready) {
        if (!mediaOperationKinds.has(operation.kind)) {
          sendable.push(operation)
          continue
        }
        try {
          const dependencyMedia = operation.dependencies
            .map((dependency) => current.find((candidate) => candidate.operationId === dependency))
            .map((dependency) => dependency?.receipt?.serverResult)
            .find(
              (result): result is Record<string, unknown> =>
                Boolean(result) &&
                typeof result === "object" &&
                hasUploadedReference(result as Record<string, unknown>),
            )
          if (dependencyMedia && !hasUploadedReference(operation.payload)) {
            operation.payload = {
              ...operation.payload,
              media_id: dependencyMedia.media_id ?? operation.payload.media_id,
              image_id: dependencyMedia.image_id,
              bucket: dependencyMedia.bucket,
              object_path: dependencyMedia.object_path,
              content_type: dependencyMedia.content_type,
            }
            await this.store.saveOperation(operation)
          }
          let mediaId = operation.mediaIds?.[0]
          if (!mediaId && typeof operation.payload.media_id === "string")
            mediaId = operation.payload.media_id
          if (!mediaId && typeof operation.payload.image_id === "string")
            mediaId = operation.payload.image_id

          if (!hasUploadedReference(operation.payload)) {
            if (!mediaId || !this.store.getMedia || !this.transport.uploadMedia)
              throw new Error("La operación multimedia no tiene un archivo local para cargar")
            const media = await this.store.getMedia(mediaId)
            if (!media?.file && !media?.blob)
              throw new Error("La operación multimedia perdió su archivo local")
            const category =
              typeof operation.payload.category === "string"
                ? operation.payload.category
                : typeof operation.payload.section === "string"
                  ? operation.payload.section
                  : media.section
            const payloadParty = operation.payload.party
            const party =
              payloadParty === "tecnico" || payloadParty === "cliente"
                ? payloadParty
                : category === "firma_tecnico"
                  ? "tecnico"
                  : category === "firma_cliente"
                    ? "cliente"
                    : undefined
            const uploaded = await this.transport.uploadMedia({
              visitId,
              deviceId,
              operationId: operation.operationId,
              mediaId,
              kind: media.kind,
              party,
              category,
              file: media.file ?? media.blob!,
              fileName: media.fileName,
            })
            operation.payload = {
              ...operation.payload,
              media_id: uploaded.media_id,
              image_id: uploaded.image_id,
              bucket: uploaded.bucket,
              object_path: uploaded.object_path,
              content_type: uploaded.content_type,
            }
            await this.store.saveOperation(operation)
          }
          if (!hasUploadedReference(operation.payload))
            throw new Error("La operación multimedia no recibió una referencia Storage válida")
          sendable.push(operation)
        } catch (error) {
          if (operation.kind === "submit_signature" && esFirmaYaRegistrada(error)) {
            await this.marcarFirmaYaRegistrada(operation)
            firmaResueltaEnSubida = true
            continue
          }
          operation.estado = "fallida"
          operation.lastError = error instanceof Error ? error.message : "No se pudo cargar el archivo"
          const timestamp = Date.parse(this.clock.now())
          if (!Number.isNaN(timestamp))
            operation.nextRetryAt = new Date(timestamp + retryDelayMs(operation.attempts)).toISOString()
          await this.store.saveOperation(operation)
        }
      }
      if (sendable.length === 0) {
        if (firmaResueltaEnSubida) continue
        break
      }

      // Un borrador encolado con `{ media_id }` lleva la referencia de Storage si la foto ya se
      // subió (en esta pasada o antes); si no, el servidor reemplazaría la evidencia registrada.
      const referencias = referenciasDeEvidencia(current)
      for (const operation of sendable) {
        if (operation.kind !== "update_certificate_draft" || !esRegistro(operation.payload.data))
          continue
        const data = resolverEvidenciaDelBorrador(operation.payload.data, referencias)
        if (JSON.stringify(data) === JSON.stringify(operation.payload.data)) continue
        operation.payload = { ...operation.payload, data }
        await this.store.saveOperation(operation)
      }

      // El servidor exige que cada dependencia figure sincronizada de su lado; una firma que ya
      // estaba registrada quedó sincronizada solo en el dispositivo, así que no se declara.
      const resueltasLocalmente = new Set(
        current
          .filter((operation) => operation.receipt?.serverStatus === RECIBO_FIRMA_YA_REGISTRADA)
          .map((operation) => operation.operationId),
      )

      let response: Awaited<ReturnType<SyncTransport["syncVisit"]>>
      try {
        response = await this.transport.syncVisit(
          visitId,
          sendable.map((operation) => ({
            operation_id: operation.operationId,
            idempotency_key: operation.idempotencyKey ?? operation.operationId,
            kind: operation.kind,
            dependencies: operation.dependencies.filter(
              (dependency) => !resueltasLocalmente.has(dependency),
            ),
            schema_version: operation.schemaVersion,
            payload: operation.payload,
            base_versions: operation.baseVersions,
            device_timestamp: operation.deviceTimestamp ?? operation.createdAt,
          })),
          deviceId,
        )
      } catch (error) {
        if (
          esFirmaYaRegistrada(error) &&
          sendable.some((operation) => operation.kind === "submit_signature")
        ) {
          if (sendable.length === 1) {
            await this.marcarFirmaYaRegistrada(sendable[0])
            continue
          }
          aislar = true
          for (const operation of sendable) {
            operation.estado = "fallida"
            operation.lastError = error instanceof Error ? error.message : "No se pudo sincronizar"
            attempted.delete(operation.operationId)
            await this.store.saveOperation(operation)
          }
          continue
        }
        // Las que fallaron al subir su archivo ya quedaron fallidas con su propio motivo.
        for (const operation of sendable) {
          operation.estado = "fallida"
          operation.lastError = error instanceof Error ? error.message : "No se pudo sincronizar"
          const timestamp = Date.parse(this.clock.now())
          if (!Number.isNaN(timestamp))
            operation.nextRetryAt = new Date(timestamp + retryDelayMs(operation.attempts)).toISOString()
          await this.store.saveOperation(operation)
        }
        break
      }

      let acknowledged = false
      let visitaVencida = false
      for (const operation of sendable) {
        const result = response.operations.find((item) => item.operation_id === operation.operationId)
        if (!result) {
          operation.estado = "fallida"
          operation.lastError = "El servidor no confirmó la operación"
          await this.store.saveOperation(operation)
          continue
        }
        if (
          result.estado !== "sincronizada" &&
          operation.kind === "submit_signature" &&
          esFirmaYaRegistrada(result.error_message)
        ) {
          await this.marcarFirmaYaRegistrada(operation, result.server_received_at)
          acknowledged = true
          continue
        }
        if (result.estado === "conflicto") {
          // No se reintenta: queda para el Administrador (incluido el cierre por vencimiento).
          operation.estado = "conflicto"
          operation.lastError = result.error_message ?? "Conflicto de sincronización"
          delete operation.nextRetryAt
          // Por vencimiento, lo que dependía de esta operación se envía en la capa siguiente.
          if (esVisitaVencida(result.error_message)) visitaVencida = acknowledged = true
          await this.store.saveOperation(operation)
          continue
        }
        if (result.estado === "pendiente") {
          operation.estado = "fallida"
          operation.lastError = result.error_message ?? "El servidor dejó la operación pendiente"
          await this.store.saveOperation(operation)
          continue
        }
        operation.estado = "sincronizada"
        delete operation.nextRetryAt
        operation.receipt = {
          serverStatus: result.estado,
          serverResult: result.result,
          serverReceivedAt: result.server_received_at,
          acknowledgedAt: result.server_acknowledged_at ?? this.clock.now(),
        }
        await this.store.removeOperationPayload(operation.operationId, operation.receipt)
        for (const mediaId of operation.mediaIds ?? []) {
          await this.store.removeMedia?.(mediaId)
          await this.store.deleteMedia?.(mediaId)
        }
        acknowledged = true
      }

      const visit = await this.store.getVisit(visitId)
      if (visit && response.visit_acknowledgement) {
        visit.visitAcknowledgement = response.visit_acknowledgement
        visit.backendStatus = String(
          (response.visit_acknowledgement as Record<string, unknown>).backend_status ?? visit.backendStatus ?? "",
        )
      }
      // La visita venció en el servidor: el panel lo muestra aunque el lote no traiga el estado.
      if (visit && visitaVencida) visit.backendStatus = "requiere_finalizacion"
      if (visit && (response.visit_acknowledgement || visitaVencida)) await this.store.saveVisit(visit)
      if (!acknowledged && !aislar) break
    }

    const remaining = await this.store.listOperations(visitId)
    const visit = await this.store.getVisit(visitId)
    if (visit) {
      visit.synchronizationPending = remaining.some((operation) => operation.estado !== "sincronizada")
      await this.store.saveVisit(visit)
    }
    return remaining
  }

  /** Da por sincronizada una firma local cuya parte ya tenía firma registrada en el servidor. */
  private async marcarFirmaYaRegistrada(operation: OperacionOffline, serverReceivedAt?: string) {
    operation.estado = "sincronizada"
    delete operation.nextRetryAt
    delete operation.lastError
    operation.receipt = {
      serverStatus: RECIBO_FIRMA_YA_REGISTRADA,
      serverResult: {
        motivo: "La firma de esta parte ya estaba registrada en el servidor; se conserva la registrada.",
      },
      serverReceivedAt,
      acknowledgedAt: this.clock.now(),
    }
    await this.store.saveOperation(operation)
    await this.store.removeOperationPayload(operation.operationId, operation.receipt)
    for (const mediaId of operation.mediaIds ?? []) {
      await this.store.removeMedia?.(mediaId)
      await this.store.deleteMedia?.(mediaId)
    }
  }

  async retryAutomatically(visitId: string, deviceId: string) {
    return this.sync(visitId, deviceId, { respectBackoff: true })
  }
}

type StoredRecord = OperacionOffline | VisitaOffline

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB error"))
  })

export class IndexedDbOfflineStore implements WorkingSetStore {
  private readonly database: Promise<IDBDatabase>

  constructor(name = "systemsolutions-offline", version = OFFLINE_SCHEMA_VERSION) {
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains("visits")) db.createObjectStore("visits", { keyPath: "id" })
        if (!db.objectStoreNames.contains("operations")) {
          const operations = db.createObjectStore("operations", { keyPath: "operationId" })
          operations.createIndex("visitId", "visitId", { unique: false })
        }
        if (!db.objectStoreNames.contains("media")) {
          const media = db.createObjectStore("media", { keyPath: "mediaId" })
          media.createIndex("visitId", "visitId", { unique: false })
          media.createIndex("operationId", "operationId", { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("No se pudo abrir IndexedDB"))
    })
  }

  private async store(name: "visits" | "operations" | "media", mode: IDBTransactionMode) {
    const db = await this.database
    return db.transaction(name, mode).objectStore(name)
  }

  async getOperation(operationId: string) {
    return (await requestResult(await this.store("operations", "readonly").then((s) => s.get(operationId)))) as
      | OperacionOffline
      | undefined
  }

  async listOperations(visitId: string) {
    const records = (await requestResult(
      await this.store("operations", "readonly").then((s) => s.index("visitId").getAll(visitId)),
    )) as StoredRecord[]
    return records as OperacionOffline[]
  }

  async saveOperation(operation: OperacionOffline) {
    await requestResult(await this.store("operations", "readwrite").then((s) => s.put(operation)))
  }

  async saveVisit(visit: VisitaOffline) {
    await requestResult(await this.store("visits", "readwrite").then((s) => s.put(visit)))
  }

  async getVisit(visitId: string) {
    return (await requestResult(await this.store("visits", "readonly").then((s) => s.get(visitId)))) as
      | VisitaOffline
      | undefined
  }

  async listVisits() {
    return (await requestResult(await this.store("visits", "readonly").then((s) => s.getAll()))) as VisitaOffline[]
  }

  async removeVisit(visitId: string) {
    await requestResult(await this.store("visits", "readwrite").then((s) => s.delete(visitId)))
  }

  async deleteVisit(visitId: string) {
    return this.removeVisit(visitId)
  }

  async removeOperationPayload(operationId: string, receipt: OperacionOffline["receipt"]) {
    const operation = await this.getOperation(operationId)
    if (!operation) return
    await this.saveOperation({ ...operation, payload: {}, receipt, estado: "sincronizada" })
  }

  async saveMedia(media: OfflineMedia) {
    await requestResult(
      await this.store("media", "readwrite").then((s) =>
        s.put({ ...media, mediaId: media.mediaId ?? media.id }),
      ),
    )
  }

  async getMedia(mediaId: string) {
    return (await requestResult(await this.store("media", "readonly").then((s) => s.get(mediaId)))) as
      | OfflineMedia
      | undefined
  }

  async removeMedia(mediaId: string) {
    await requestResult(await this.store("media", "readwrite").then((s) => s.delete(mediaId)))
  }

  async deleteMedia(mediaId: string) {
    return this.removeMedia(mediaId)
  }
}
