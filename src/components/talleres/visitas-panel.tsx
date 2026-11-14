"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react"
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CloudOff,
  FileCheck2,
  ImagePlus,
  Lock,
  Paperclip,
  RefreshCw,
  Wifi,
} from "lucide-react"

import { SignaturePad, dataUrlToFile } from "@/components/certificados/signature-pad"
import {
  CertificateCaptureForm,
  type EstadoFotoEvidencia,
} from "@/components/certificados/certificate-capture-form"
import { SelectNativo } from "@/components/common/select-nativo"
import { ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { edgeApi } from "@/lib/api"
import { CERTIFICATE_EVIDENCE_SECTIONS, type CertificateEvidenceKey } from "@/lib/api/certificates"
import {
  idsDeImagenes,
  listarFotosParteDiario,
  textoCantidadFotos,
  type FotoParteDiarioSesion,
} from "@/lib/media/fotos-parte-diario"
import { prepararImagen } from "@/lib/media/preparar-imagen"
import { useEdgeCertificateCaptureCatalogs, useEdgeCertificateDraft } from "@/lib/api/hooks"
import type {
  CertificateCaptureCatalogsDto,
  VisitDto,
  WorkOrderDetailDto,
} from "@/lib/api/contracts"
import { certificateTemplateSchema } from "@/lib/api/contracts"
import { traducirMensajeError } from "@/lib/domain/errores"
import { crearCoordinadorEdge as createCoordinator } from "@/lib/offline/coordinador-edge"
import {
  IndexedDbOfflineStore,
  OfflineSyncCoordinator,
  certificateCatalogsForVisit,
  esFirmaYaRegistrada,
  pinVisitCertificateCatalogs,
  queueOfflineSignatureCapture,
  referenciasDeEvidencia,
  refreshedVisitCatalogs,
  resolverEvidenciaDelBorrador,
  syncPendingVisitStartsBeforeRefresh,
  type OperacionOffline,
  type VisitaOffline,
} from "@/lib/offline/sync"
import { visitCompletionBlocker } from "@/lib/offline/completion"
import { getOfflineDeviceId as deviceId } from "@/lib/offline/device"
import { Cargando } from "@/components/common/cargando"
import {
  cargarResumenesDeVisitas,
  codigoPdSugerido,
  conResumenGuardado,
  resumenGuardado,
} from "./resumenes-visitas"
import { tituloDeVisita, type ResumenVisita, type TituloVisita } from "./visita-titulo"
import { visitaIniciada } from "./estado-visita"
import { nombreDeTecnico, type TecnicoAsignado } from "./tecnicos"
import { fmtFechaHoraArgentina } from "@/lib/format"

type StoredVisitContext = VisitDto & {
  context?: unknown
  assigned_technicians?: TecnicoAsignado[]
  certificate_catalogs?: CertificateCaptureCatalogsDto
}

type CachedWorkOrder = WorkOrderDetailDto & {
  certificate_id?: string | null
  certificate?: Record<string, unknown> | null
}

function contextOf(visit: VisitaOffline) {
  return (visit.context ?? {}) as StoredVisitContext
}

/** Rótulo de la visita con nombres (nunca el id); sin resumen de operación usa la fecha. */
function visitLabel(visit: VisitaOffline, resumen: ResumenVisita | undefined): TituloVisita {
  const row = contextOf(visit).visit as Record<string, unknown> | undefined
  return tituloDeVisita(
    { id: visit.id, starts_at: row?.starts_at ?? row?.fecha_inicio ?? row?.fecha_ejecucion },
    resumen ?? resumenGuardado(visit.context),
  )
}

/** Contacto y teléfono de la visita; el teléfono es un enlace `tel:` con área táctil de 44px. */
function ContactoVisita({ rotulo }: { rotulo: TituloVisita }) {
  if (!rotulo.contacto && !rotulo.telefono) return null
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      {rotulo.contacto ? <span>{rotulo.contacto}</span> : null}
      {rotulo.telefono ? (
        <a
          href={`tel:${rotulo.telefono.replace(/[^\d+]/g, "")}`}
          className="inline-flex items-center text-primary underline underline-offset-2 pointer-coarse:min-h-11"
        >
          {rotulo.telefono}
        </a>
      ) : null}
    </p>
  )
}

function visitDate(visit: VisitaOffline) {
  const row = contextOf(visit).visit as Record<string, unknown> | undefined
  const value = row?.starts_at ?? row?.fecha_inicio ?? row?.fecha_ejecucion
  return fmtFechaHoraArgentina(value) ?? "Fecha no informada"
}

function findEquipo(context: StoredVisitContext, equipoId: string | undefined) {
  if (!equipoId) return undefined
  const tree = context.context as { equipos?: Record<string, unknown>[] } | undefined
  return tree?.equipos?.find((equipo) => equipo.id === equipoId)
}

export function findValve(
  context: StoredVisitContext,
  valveId: string | undefined,
  order?: WorkOrderDetailDto,
  certificate?: Record<string, unknown>,
) {
  const tree = context.context as { valvulas?: Record<string, unknown>[] } | undefined
  const fromTree = valveId ? tree?.valvulas?.find((valve) => valve.id === valveId) : undefined
  const rawOrder = (order ?? {}) as Record<string, unknown>
  const fromOrder =
    rawOrder.valvula && typeof rawOrder.valvula === "object" && !Array.isArray(rawOrder.valvula)
      ? (rawOrder.valvula as Record<string, unknown>)
      : undefined
  const certContext =
    certificate?.contexto_captura &&
    typeof certificate.contexto_captura === "object" &&
    !Array.isArray(certificate.contexto_captura)
      ? (certificate.contexto_captura as Record<string, unknown>)
      : undefined
  const fromCert =
    certContext?.valvula &&
    typeof certContext.valvula === "object" &&
    !Array.isArray(certContext.valvula)
      ? (certContext.valvula as Record<string, unknown>)
      : undefined

  const merged: Record<string, unknown> = {}
  for (const source of [fromCert, fromTree, fromOrder]) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        merged[key] = value
      } else if (!(key in merged)) {
        merged[key] = value
      }
    }
  }
  if (
    typeof rawOrder.valvula_nombre === "string" &&
    rawOrder.valvula_nombre.trim() !== "" &&
    !merged.nombre &&
    !merged.tag
  ) {
    merged.nombre = rawOrder.valvula_nombre.trim()
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function workOrderName(
  order: WorkOrderDetailDto,
  context: StoredVisitContext,
  certificate?: Record<string, unknown>,
) {
  const valve = findValve(context, order.valvula_id, order, certificate)
  const rawOrder = order as Record<string, unknown>
  const valveName =
    (typeof rawOrder.valvula_nombre === "string" && rawOrder.valvula_nombre.trim()) ||
    (typeof valve?.nombre === "string" && valve.nombre.trim()) ||
    (typeof valve?.tag === "string" && valve.tag.trim()) ||
    ""
  const equipoId = typeof valve?.equipo_id === "string" ? valve.equipo_id : undefined
  const equipo = findEquipo(context, equipoId)
  const certContext =
    certificate?.contexto_captura &&
    typeof certificate.contexto_captura === "object" &&
    !Array.isArray(certificate.contexto_captura)
      ? (certificate.contexto_captura as Record<string, unknown>)
      : undefined
  const certEquipo =
    certContext?.equipo &&
    typeof certContext.equipo === "object" &&
    !Array.isArray(certContext.equipo)
      ? (certContext.equipo as Record<string, unknown>)
      : undefined
  const equipoName =
    (typeof rawOrder.equipo_nombre === "string" && rawOrder.equipo_nombre.trim()) ||
    (typeof equipo?.nombre === "string" && equipo.nombre.trim()) ||
    (typeof certEquipo?.nombre === "string" && certEquipo.nombre.trim()) ||
    ""

  if (valveName && equipoName) return `Válvula ${valveName} · Equipo ${equipoName}`
  if (valveName) return `Válvula ${valveName}`
  if (equipoName) return `Equipo ${equipoName}`
  return "Válvula asignada"
}

type Aviso = { texto: string; lugar: "general" | "cliente" | "cierre"; error?: boolean }

/** Texto en español de un error capturado, con el motivo del servidor traducido. */
function textoDeError(caught: unknown, porDefecto: string) {
  return caught instanceof Error && caught.message
    ? traducirMensajeError(caught.message)
    : porDefecto
}

/** Confirma en el servidor si la visita ya quedó completada (por ejemplo, en un intento previo). */
async function visitaYaCompletada(visitId: string) {
  try {
    const { visit } = await edgeApi.serviceWorkflow.visit(visitId)
    return visit.estado === "completada"
  } catch {
    return false
  }
}

async function pendingStartOperationIds(store: IndexedDbOfflineStore, visitId: string) {
  return (await store.listOperations(visitId))
    .filter((operation) => operation.kind === "start_visit" && operation.estado !== "sincronizada")
    .map((operation) => operation.operationId)
}

async function pendingCompletionOperationIds(store: IndexedDbOfflineStore, visitId: string) {
  return (await store.listOperations(visitId))
    .filter((operation) => operation.kind !== "complete_visit" && operation.estado !== "sincronizada")
    .map((operation) => operation.operationId)
}

export function VisitasPanel() {
  const [visits, setVisits] = useState<VisitaOffline[]>([])
  const [pendingVisits, setPendingVisits] = useState<VisitDto[]>([])
  const [operations, setOperations] = useState<Record<string, OperacionOffline[]>>({})
  const [selectedId, setSelectedId] = useState<string>()
  const [acceptingVisitId, setAcceptingVisitId] = useState<string>()
  const [resumenes, setResumenes] = useState<Map<string, ResumenVisita>>(() => new Map())
  const [pendingError, setPendingError] = useState<string>()
  const [acceptMessage, setAcceptMessage] = useState<string>()
  const [connection, setConnection] = useState<"online" | "offline" | "loading" | "error">("loading")
  const [error, setError] = useState<string>()

  const loadLocal = useCallback(async () => {
    const store = new IndexedDbOfflineStore()
    const cached = await store.listVisits()
    // Orden estable por horario de la visita (y id): ordenar por `cachedAt` movía la tarjeta
    // abierta en cada refresco y cortaba el trazo de una firma en curso (N1 de e2e).
    const inicio = (visit: VisitaOffline) => String(contextOf(visit).visit?.starts_at ?? "")
    setVisits(
      cached.sort((a, b) => inicio(a).localeCompare(inicio(b)) || a.id.localeCompare(b.id)),
    )
    const entries: Record<string, OperacionOffline[]> = {}
    for (const visit of cached) entries[visit.id] = await store.listOperations(visit.id)
    setOperations(entries)
  }, [])

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return
    if (!navigator.onLine) {
      setConnection("offline")
      await loadLocal()
      return
    }
    setConnection("loading")
    setError(undefined)
    try {
      const store = new IndexedDbOfflineStore()
      await syncPendingVisitStartsBeforeRefresh(store, (visitId) =>
        createCoordinator(store).sync(visitId, deviceId()),
      )
      const cachedVisitsBeforeRefresh = await store.listVisits()
      for (const cachedVisit of cachedVisitsBeforeRefresh) {
        const pendingOperations = await store.listOperations(cachedVisit.id)
        if (pendingOperations.some((operation) => operation.estado !== "sincronizada"))
          await createCoordinator(store).sync(cachedVisit.id, deviceId())
      }
      const workingSet = await edgeApi.offline.workingSet(deviceId())
      // Nombres de cliente, yacimiento y planta: la lista de visitas solo trae ids. Mejor esfuerzo.
      const loadedSummaries = await cargarResumenesDeVisitas()
      setResumenes(loadedSummaries)
      const signaturesByVisit = new Map<string, { parte?: string; nombre_firmante?: string }[]>()
      try {
        const assignedVisits = await edgeApi.serviceWorkflow.listVisits()
        for (const entry of assignedVisits) {
          const visitRow = entry.visit as typeof entry.visit & {
            signatures?: { parte?: string; nombre_firmante?: string }[]
          }
          if (visitRow.signatures) signaturesByVisit.set(entry.visit.id, visitRow.signatures)
        }
        setPendingVisits(
          assignedVisits
            .filter((entry) => entry.visit.estado === "programada")
            .sort((a, b) => {
              const startsAtA = typeof a.visit.starts_at === "string" ? a.visit.starts_at : ""
              const startsAtB = typeof b.visit.starts_at === "string" ? b.visit.starts_at : ""
              return startsAtA.localeCompare(startsAtB)
            }),
        )
        setPendingError(undefined)
      } catch (caught) {
        setPendingError(
          caught instanceof Error ? caught.message : "No se pudieron cargar las visitas programadas",
        )
      }
      const serverIds = new Set(workingSet.visits.map((entry) => entry.visit.id))
      const cached = await store.listVisits()
      for (const old of cached) {
        const pending = (await store.listOperations(old.id)).some(
          (operation) => operation.estado !== "sincronizada",
        )
        if (!serverIds.has(old.id) && !pending) await store.removeVisit(old.id)
      }
      for (const entry of workingSet.visits) {
        const old = await store.getVisit(entry.visit.id)
        const entryCatalogs = entry.certificate_catalogs ?? workingSet.certificate_catalogs
        const oldContext = old?.context as StoredVisitContext | undefined
        const signatures =
          signaturesByVisit.get(entry.visit.id) ??
          (entry.visit as typeof entry.visit & {
            signatures?: { parte?: string; nombre_firmante?: string }[]
          }).signatures ??
          (oldContext?.visit as (typeof entry.visit & {
            signatures?: { parte?: string; nombre_firmante?: string }[]
          }) | undefined)?.signatures
        const catalogState = refreshedVisitCatalogs({
          previous: old,
          // El resumen viaja dentro del contexto guardado para rotular la visita sin conexión.
          refreshedContext: conResumenGuardado(
            {
              ...entry,
              visit: signatures ? { ...entry.visit, signatures } : entry.visit,
              certificate_catalogs: entryCatalogs,
            },
            loadedSummaries.get(entry.visit.id),
            old?.context,
          ),
          refreshedCatalogs: entryCatalogs,
        })
        await store.saveVisit({
          id: entry.visit.id,
          ...catalogState,
          cachedAt: new Date().toISOString(),
          estadoLocal: old?.estadoLocal ?? "disponible",
          synchronizationPending: old?.synchronizationPending ?? false,
          backendStatus: entry.visit.estado ?? old?.backendStatus,
          visitAcknowledgement: old?.visitAcknowledgement,
          claimedByDeviceId: old?.claimedByDeviceId,
          claimedAt: old?.claimedAt,
        })
      }
      await loadLocal()
      setConnection("online")
    } catch (caught) {
      setConnection("error")
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la agenda de campo")
      await loadLocal()
    }
  }, [loadLocal])

  const acceptVisit = useCallback(async (visitId: string) => {
    setAcceptingVisitId(visitId)
    setPendingError(undefined)
    setAcceptMessage(undefined)
    try {
      await edgeApi.serviceWorkflow.transition(visitId, "accept")
      setAcceptMessage("Visita aceptada. Actualicé la agenda de campo.")
      await refresh()
    } catch (caught) {
      setPendingError(caught instanceof Error ? caught.message : "No se pudo aceptar la visita")
    } finally {
      setAcceptingVisitId(undefined)
    }
  }, [refresh])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0)
    const online = () => void refresh()
    const offline = () => {
      setConnection("offline")
      void loadLocal()
    }
    window.addEventListener("online", online)
    window.addEventListener("offline", offline)
    return () => {
      window.clearTimeout(initialRefresh)
      window.removeEventListener("online", online)
      window.removeEventListener("offline", offline)
    }
  }, [loadLocal, refresh])

  const selected = visits.find((visit) => visit.id === selectedId)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {connection === "offline" || connection === "error" ? (
            <CloudOff className="size-4" />
          ) : (
            <Wifi className="size-4" />
          )}
          {connection === "offline"
            ? "Trabajando offline"
            : connection === "loading"
              ? "Actualizando…"
              : connection === "error"
                ? "Sin conexión al servidor"
              : "Conectado"}
        </div>
        <Button
          variant="outline"
          className="max-sm:w-full"
          onClick={() => void refresh()}
          disabled={connection === "loading"}
        >
          <RefreshCw className="mr-2 size-4" /> Actualizar agenda
        </Button>
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refresh()} /> : null}
      <section className="space-y-3" aria-labelledby="pending-visits-title">
        <div>
          <h2 id="pending-visits-title" className="text-lg font-semibold">Visitas Pendientes</h2>
          <p className="text-sm text-muted-foreground">
            Confirmá las visitas asignadas al Taller Móvil para agregarlas a la agenda de campo.
          </p>
        </div>
        {pendingError ? <p role="alert" className="text-sm text-destructive">{pendingError}</p> : null}
        {acceptMessage ? <p role="status" className="text-sm text-muted-foreground">{acceptMessage}</p> : null}
        {pendingVisits.length > 0 ? (
          <div className="space-y-2">
            {pendingVisits.map(({ visit, work_orders: workOrders }) => {
              const rotulo = tituloDeVisita(visit, resumenes.get(visit.id))
              return (
              <Card key={visit.id} size="sm">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium break-words">{rotulo.titulo}</p>
                    <p className="text-sm text-muted-foreground">
                      {fmtFechaHoraArgentina(visit.starts_at) ?? "Fecha no informada"}
                      {` · ${workOrders.length} orden${workOrders.length === 1 ? "" : "es"} de trabajo`}
                    </p>
                    <ContactoVisita rotulo={rotulo} />
                  </div>
                  <Button
                    type="button"
                    className="max-sm:w-full"
                    onClick={() => void acceptVisit(visit.id)}
                    disabled={connection !== "online" || acceptingVisitId !== undefined}
                  >
                    {acceptingVisitId === visit.id ? "Aceptando…" : "Aceptar"}
                  </Button>
                </CardContent>
              </Card>
              )
            })}
          </div>
        ) : !pendingError ? (
          <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            {connection === "offline"
              ? "Conectate para consultar las visitas pendientes de aceptación."
              : "No hay visitas pendientes de aceptación."}
          </p>
        ) : null}
      </section>
      <section className="space-y-3" aria-labelledby="scheduled-visits-title">
        <h2 id="scheduled-visits-title" className="text-lg font-semibold">Visitas Programadas</h2>
        {visits.length === 0 && connection !== "loading" ? (
          <p className="rounded-lg border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            Las visitas aceptadas aparecerán aquí cuando estén dentro de los próximos dos días.
          </p>
        ) : null}
        <div className="grid gap-4 xl:grid-cols-2">
          {visits.map((visit) => (
            <VisitCard
              key={visit.id}
              visit={visit}
              resumen={resumenes.get(visit.id)}
              operations={operations[visit.id] ?? []}
              open={selectedId === visit.id}
              onOpen={() => setSelectedId(selectedId === visit.id ? undefined : visit.id)}
              onChanged={refresh}
            />
          ))}
        </div>
      </section>
      {selected ? <div className="sr-only">Visita seleccionada: {visitLabel(selected, resumenes.get(selected.id)).titulo}</div> : null}
    </div>
  )
}

function VisitCard({
  visit,
  resumen,
  operations,
  open,
  onOpen,
  onChanged,
}: {
  visit: VisitaOffline
  resumen?: ResumenVisita
  operations: OperacionOffline[]
  open: boolean
  onOpen: () => void
  onChanged: () => Promise<void>
}) {
  const store = useMemo(() => new IndexedDbOfflineStore(), [])
  const context = contextOf(visit)
  const rotulo = visitLabel(visit, resumen)
  const [attachments, setAttachments] = useState<Awaited<ReturnType<typeof edgeApi.serviceWorkflow.visitAttachments>>>([])
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null)
  const [loadingAttachments, setLoadingAttachments] = useState(false)
  const pending = operations.filter((operation) => operation.estado !== "sincronizada")
  const conflicts = operations.filter((operation) => operation.estado === "conflicto")
  const failed = operations.filter((operation) => operation.estado === "fallida")
  // Motivos de los cambios fallidos, traducidos y sin repetir.
  const failedReasons = [
    ...new Set(
      failed.map((operation) =>
        traducirMensajeError(operation.lastError ?? "No se pudo sincronizar el cambio"),
      ),
    ),
  ]
  const [retrying, setRetrying] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string>()

  const retrySync = async () => {
    if (!navigator.onLine) {
      setRetryMessage("Sin conexión: conectate para reintentar la sincronización.")
      return
    }
    setRetrying(true)
    setRetryMessage(undefined)
    try {
      const remaining = await createCoordinator(store).sync(visit.id, deviceId())
      const unsynced = remaining.filter((operation) => operation.estado !== "sincronizada").length
      await onChanged()
      setRetryMessage(
        unsynced === 0
          ? "Sincronización completa: todos los cambios llegaron al servidor."
          : `Quedan ${unsynced} cambio(s) sin sincronizar. Revisá el motivo de cada uno.`,
      )
    } catch (caught) {
      setRetryMessage(textoDeError(caught, "No se pudo sincronizar la visita"))
    } finally {
      setRetrying(false)
    }
  }

  // Al abrir (o cambiar de visita) se marca la carga durante el render, sin setState en el efecto.
  const attachmentsKey = open ? visit.id : null
  const [loadedAttachmentsKey, setLoadedAttachmentsKey] = useState<string | null>(null)
  if (attachmentsKey !== loadedAttachmentsKey) {
    setLoadedAttachmentsKey(attachmentsKey)
    if (attachmentsKey) {
      setLoadingAttachments(true)
      setAttachmentsError(null)
    }
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void edgeApi.serviceWorkflow.visitAttachments(visit.id)
      .then((files) => { if (!cancelled) setAttachments(files) })
      .catch((error: unknown) => {
        if (!cancelled) setAttachmentsError(error instanceof Error ? error.message : "No se pudieron cargar los adjuntos")
      })
      .finally(() => { if (!cancelled) setLoadingAttachments(false) })
    return () => { cancelled = true }
  }, [open, visit.id])

  return (
    <Card
      className={cn(
        "overflow-visible max-sm:[--card-spacing:--spacing(3)]",
        open && "xl:col-span-full",
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <CardTitle className="break-words" data-visit-id={visit.id}>{rotulo.titulo}</CardTitle>
            <CardDescription>
              {visitDate(visit)} · Visita de servicio
              {rotulo.referencia ? ` · ${rotulo.referencia}` : null}
            </CardDescription>
          </div>
          <Badge
            variant={
              conflicts.length
                ? "destructive"
                : visit.estadoLocal === "completada_local"
                  ? "secondary"
                  : "outline"
            }
          >
            {conflicts.length
              ? "Conflicto"
              : visit.estadoLocal === "completada_local"
                ? "Completada localmente"
                : pending.length
                  ? "Pendiente de sincronización"
                  : "Disponible"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ContactoVisita rotulo={rotulo} />
        <div className="flex flex-wrap gap-2 text-sm">
          <span>{context.work_orders?.length ?? 0} Órdenes de trabajo</span>
          {pending.length ? <span>· {pending.length} cambio(s) local(es)</span> : null}
        </div>
        {conflicts.length ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            Conflicto de sincronización: se conservan los datos locales para resolución
            administrativa.
            {conflicts.map((operation) => (
              <p key={operation.operationId}>{operation.lastError}</p>
            ))}
          </div>
        ) : null}
        {failed.length ? (
          <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p>Hay cambios fallidos. Podés reintentar sin volver a capturar el trabajo.</p>
            <ul aria-label="Motivos de los cambios fallidos" className="list-disc space-y-1 pl-5">
              {failedReasons.map((reason) => (
                <li key={reason} className="break-words">
                  {reason}
                </li>
              ))}
            </ul>
            <Button
              type="button"
              variant="outline"
              className="max-sm:w-full"
              onClick={() => void retrySync()}
              disabled={retrying}
              aria-busy={retrying}
            >
              <RefreshCw className={cn("mr-2 size-4", retrying && "animate-spin")} />
              {retrying ? "Sincronizando…" : "Reintentar sincronización"}
            </Button>
          </div>
        ) : null}
        {retryMessage ? (
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {retryMessage}
          </p>
        ) : null}
        <Button variant="outline" className="max-sm:w-full" onClick={onOpen}>
          {open ? <ChevronUp className="mr-2 size-4" /> : <ChevronDown className="mr-2 size-4" />}
          {open ? "Cerrar visita" : "Abrir visita"}
        </Button>
        {open ? (
          <section aria-label="Adjuntos de la solicitud" className="space-y-2 rounded-md border p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium"><Paperclip className="size-4" />Adjuntos de la solicitud</h3>
            {loadingAttachments ? <Cargando variante="linea" texto="Cargando adjuntos…" /> : null}
            {attachmentsError ? <p className="text-sm text-muted-foreground">{attachmentsError}</p> : null}
            {!loadingAttachments && !attachmentsError && attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay archivos adjuntos.</p>
            ) : null}
            {attachments.map((file) => (
              <a key={file.id} href={file.url} download target="_blank" rel="noreferrer" className="block truncate text-sm text-primary underline">
                {file.nombre}
              </a>
            ))}
          </section>
        ) : null}
        {open ? (
          <VisitEditor
            visit={visit}
            store={store}
            pdSugerido={codigoPdSugerido(resumen ?? resumenGuardado(visit.context))}
            onChanged={onChanged}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

function VisitEditor({
  visit,
  store,
  pdSugerido = "",
  onChanged,
}: {
  visit: VisitaOffline
  store: IndexedDbOfflineStore
  /** PD/RTO de la tarea, normalizado: se ofrece mientras la visita no tenga un PD guardado (D12). */
  pdSugerido?: string
  onChanged: () => Promise<void>
}) {
  // Un único aviso con role="status"; se muestra junto al paso que lo originó (firma del Cliente o
  // cierre) para que se vea al lado del botón, y al pie para el resto.
  const [aviso, setAviso] = useState<Aviso>()
  const setMessage = useCallback(
    (texto?: string) => setAviso(texto ? { texto, lugar: "general" } : undefined),
    [],
  )
  const avisarCliente = (texto: string, error = false) =>
    setAviso({ texto, lugar: "cliente", error })
  const avisarCierre = (texto: string, error = false) =>
    setAviso({ texto, lugar: "cierre", error })
  const [completing, setCompleting] = useState(false)
  const [clientSigner, setClientSigner] = useState("")
  const [clientSignature, setClientSignature] = useState<string>()
  const [clientSignatureSaved, setClientSignatureSaved] = useState(false)
  const [clientSignatureSkipped, setClientSignatureSkipped] = useState(false)
  const [clientSignatureOperationId, setClientSignatureOperationId] = useState<string>()
  const [savingClientSignature, setSavingClientSignature] = useState(false)
  const [technician, setTechnician] = useState("")
  const [customTechnician, setCustomTechnician] = useState(false)
  const [technicianSignature, setTechnicianSignature] = useState<string>()
  // La firma del Técnico se sube antes de completar; si el cierre falla, el reintento no la vuelve
  // a subir porque el backend no permite reemplazarla (D2).
  const [technicianSignatureUploaded, setTechnicianSignatureUploaded] = useState(false)
  const [incompleteReason, setIncompleteReason] = useState(
    "Falta de tiempo en jornada — reprogramar válvulas pendientes",
  )
  const [savingIncomplete, setSavingIncomplete] = useState(false)
  const [pdCode, setPdCode] = useState("")
  const [pdEditado, setPdEditado] = useState(false)
  const [savedPdCode, setSavedPdCode] = useState<string | null>(null)
  const [pdImagesCount, setPdImagesCount] = useState(0)
  const [savingPd, setSavingPd] = useState(false)
  // Estado de la última foto del PD, visible dentro de la propia tarjeta (no solo al pie).
  const [pdPhotoStatus, setPdPhotoStatus] = useState<{
    tipo: "subiendo" | "ok" | "error"
    texto: string
  } | null>(null)
  const [pdRemoteImageIds, setPdRemoteImageIds] = useState<string[]>([])
  const [pdSessionPhotos, setPdSessionPhotos] = useState<FotoParteDiarioSesion[]>([])
  const [openingPdImage, setOpeningPdImage] = useState<string | null>(null)
  const pdObjectUrls = useRef<string[]>([])
  const context = contextOf(visit)
  const visitRow = context.visit as
    | {
        signatures?: { parte?: string; nombre_firmante?: string }[]
        parte_diario?: { codigo?: string | null; images?: unknown[] }
      }
    | undefined
  const existingClientSignature = visitRow?.signatures?.find((signature) => signature.parte === "cliente")
  const hasTechnicianSignature =
    technicianSignatureUploaded ||
    !!visitRow?.signatures?.some((signature) => signature.parte === "tecnico")
  const coordinator = useMemo(() => createCoordinator(store), [store])
  const technicians = context.assigned_technicians ?? []
  const catalogsQuery = useEdgeCertificateCaptureCatalogs(
    typeof navigator !== "undefined" && navigator.onLine,
  )
  const catalogs = certificateCatalogsForVisit(
    visit,
    context.certificate_catalogs ?? catalogsQuery.data,
  )
  const closed = visit.estadoLocal === "completada_local"
  const clientSignatureStepDone = clientSignatureSaved || clientSignatureSkipped
  const started = visitaIniciada(visit, context.visit?.estado)

  // La firma del Cliente ya registrada se refleja durante el render; el efecto solo consulta la
  // cola local cuando todavía no existe.
  const existingClientSigner = existingClientSignature
    ? (existingClientSignature.nombre_firmante ?? "")
    : null
  const [appliedClientSigner, setAppliedClientSigner] = useState<string | null>(null)
  if (existingClientSigner !== null && existingClientSigner !== appliedClientSigner) {
    setAppliedClientSigner(existingClientSigner)
    setClientSigner(existingClientSigner)
    setClientSignatureSaved(true)
  }
  const hasExistingClientSignature = existingClientSigner !== null

  useEffect(() => {
    if (hasExistingClientSignature) return

    void store.listOperations(visit.id).then((pendingOperations) => {
      const clientOperation = pendingOperations.find(
        (operation) =>
          operation.kind === "submit_signature" &&
          operation.payload.party === "cliente" &&
          operation.estado !== "conflicto" &&
          operation.estado !== "fallida",
      )
      if (clientOperation) {
        setClientSigner(String(clientOperation.payload.signer_name ?? ""))
        setClientSignatureOperationId(clientOperation.operationId)
        setClientSignatureSaved(true)
      }
    })
  }, [hasExistingClientSignature, store, visit.id])

  useEffect(() => {
    let cancelled = false
    const loadParteDiario = async () => {
      const pendingOps = await store.listOperations(visit.id)
      const latestCodeOp = pendingOps
        .filter(
          (op) =>
            op.kind === "set_part_diario" &&
            op.estado !== "conflicto" &&
            op.estado !== "fallida" &&
            typeof op.payload.codigo === "string",
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId))
        .at(-1)
      const queuedImageOps = pendingOps.filter(
        (op) =>
          op.kind === "attach_part_diario_image" &&
          op.estado !== "sincronizada" &&
          op.estado !== "conflicto" &&
          op.estado !== "fallida",
      )
      const cachedCode =
        typeof latestCodeOp?.payload.codigo === "string"
          ? latestCodeOp.payload.codigo
          : typeof visitRow?.parte_diario?.codigo === "string"
            ? visitRow.parte_diario.codigo
            : ""
      const cachedImages = Array.isArray(visitRow?.parte_diario?.images)
        ? visitRow.parte_diario.images.length
        : 0

      if (!cancelled && cachedCode) {
        setPdCode((prev) => prev || cachedCode)
        setSavedPdCode(cachedCode)
      }
      if (!cancelled) {
        setPdImagesCount(cachedImages + queuedImageOps.length)
        setPdRemoteImageIds(idsDeImagenes(visitRow?.parte_diario?.images))
      }

      if (typeof navigator !== "undefined" && navigator.onLine) {
        try {
          const remotePd = await edgeApi.serviceWorkflow.visitParteDiario(visit.id)
          if (!cancelled) {
            const effectiveCode =
              (typeof latestCodeOp?.payload.codigo === "string" && latestCodeOp.payload.codigo) ||
              remotePd.codigo ||
              ""
            if (effectiveCode) {
              setPdCode((prev) => prev || effectiveCode)
              setSavedPdCode(effectiveCode)
            }
            setPdImagesCount(remotePd.images.length + queuedImageOps.length)
            setPdRemoteImageIds(remotePd.images.map((image) => image.id))
          }
        } catch {
          // Best-effort online fetch; local state remains authoritative when offline.
        }
      }
    }
    void loadParteDiario()
    return () => {
      cancelled = true
    }
  }, [store, visit.id, visitRow?.parte_diario])

  // Las miniaturas de las fotos de esta sesión usan URLs locales que se liberan al desmontar.
  useEffect(() => {
    const urls = pdObjectUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])

  // Sin PD guardado ni escrito, se precarga el PD/RTO de la tarea; si el técnico borra el campo,
  // la sugerencia no vuelve a aparecer.
  const pdValor = pdCode || (pdEditado ? "" : pdSugerido)
  const pdPhotoList = listarFotosParteDiario(pdRemoteImageIds, pdSessionPhotos)

  const saveParteDiarioCode = async (rawCode = pdValor): Promise<string | null> => {
    const normalized = rawCode.trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase()
    if (!normalized) {
      setMessage("Ingresá un número o código alfanumérico de Parte Diario.")
      return null
    }
    setSavingPd(true)
    try {
      if (navigator.onLine) {
        await edgeApi.serviceWorkflow.setVisitParteDiario(visit.id, normalized)
      } else {
        const dependencies = await pendingStartOperationIds(store, visit.id)
        await coordinator.queue(
          visit.id,
          deviceId(),
          "set_part_diario",
          { codigo: normalized },
          dependencies,
        )
      }
      setPdCode(normalized)
      setSavedPdCode(normalized)
      setMessage(
        navigator.onLine
          ? `Parte Diario ${normalized} registrado en la visita.`
          : `Parte Diario ${normalized} guardado en el dispositivo para sincronizar.`,
      )
      await onChanged()
      return normalized
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "No se pudo guardar el Parte Diario",
      )
      return null
    } finally {
      setSavingPd(false)
    }
  }

  const captureParteDiarioPhoto = async (picked: File | undefined) => {
    if (!picked || closed || !started) return
    const normalized = (pdValor || savedPdCode || "")
      .trim()
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
    if (!normalized) {
      const texto = "Ingresá primero el número de Parte Diario antes de adjuntar su foto."
      setPdPhotoStatus({ tipo: "error", texto })
      setMessage(texto)
      return
    }
    const online = navigator.onLine
    setSavingPd(true)
    setPdPhotoStatus({
      tipo: "subiendo",
      texto: online ? "Subiendo foto…" : "Guardando foto en el dispositivo…",
    })
    let saved = false
    try {
      // Convierte HEIC y reduce las fotos pesadas de la cámara al formato que acepta el servidor.
      const file = await prepararImagen(picked)
      const imageId = window.crypto.randomUUID()
      if (online) {
        await edgeApi.serviceWorkflow.setVisitParteDiario(visit.id, normalized)
        await edgeApi.serviceWorkflow.uploadVisitParteDiarioImage(visit.id, {
          codigo: normalized,
          imageId,
          file,
        })
      } else {
        await store.saveMedia?.({
          id: imageId,
          mediaId: imageId,
          visitId: visit.id,
          operationId: imageId,
          kind: "photo",
          section: "parte_diario",
          blob: file,
          file,
          contentType: file.type,
          fileName: file.name || `parte-diario-${imageId}.jpg`,
          createdAt: new Date().toISOString(),
        })
        const existingOps = await store.listOperations(visit.id)
        const startDeps = await pendingStartOperationIds(store, visit.id)
        const existingSetOp = existingOps
          .filter(
            (op) =>
              op.kind === "set_part_diario" &&
              op.payload.codigo === normalized &&
              op.estado !== "conflicto" &&
              op.estado !== "fallida",
          )
          .at(-1)
        const setOp =
          existingSetOp ??
          (await coordinator.queue(
            visit.id,
            deviceId(),
            "set_part_diario",
            { codigo: normalized },
            startDeps,
          ))
        await coordinator.queue(
          visit.id,
          deviceId(),
          "attach_part_diario_image",
          {
            codigo: normalized,
            media_id: imageId,
            image_id: imageId,
            category: "parte_diario",
            content_type: file.type,
          },
          [...new Set([...startDeps, setOp.operationId])],
          { mediaIds: [imageId] },
        )
      }
      const url = URL.createObjectURL(file)
      pdObjectUrls.current.push(url)
      setPdSessionPhotos((current) => [
        ...current,
        { id: imageId, nombre: file.name || "foto.jpg", url, pendiente: !online },
      ])
      if (online)
        setPdRemoteImageIds((current) => (current.includes(imageId) ? current : [...current, imageId]))
      setPdCode(normalized)
      setSavedPdCode(normalized)
      setPdImagesCount((count) => count + 1)
      const texto = online
        ? `Foto del Parte Diario ${normalized} adjuntada a la visita.`
        : `Foto del Parte Diario ${normalized} guardada localmente y lista para sincronizar.`
      setPdPhotoStatus({ tipo: "ok", texto })
      setMessage(texto)
      saved = true
    } catch (caught) {
      const texto =
        caught instanceof Error ? caught.message : "No se pudo adjuntar la foto del Parte Diario"
      setPdPhotoStatus({ tipo: "error", texto })
      setMessage(texto)
    } finally {
      setSavingPd(false)
    }
    if (saved) await onChanged()
  }

  // La foto se pide al backend y se abre en otra pestaña. La pestaña se abre antes de esperar la
  // descarga para que el navegador del celular no la bloquee como ventana emergente.
  const openParteDiarioImage = async (imageId: string) => {
    const tab = window.open("", "_blank")
    setOpeningPdImage(imageId)
    try {
      const response = await edgeApi.serviceWorkflow.downloadVisitParteDiarioImage(visit.id, imageId)
      const url = URL.createObjectURL(await response.blob())
      if (tab) tab.location.href = url
      else window.open(url, "_blank")
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (caught) {
      tab?.close()
      setPdPhotoStatus({
        tipo: "error",
        texto: caught instanceof Error ? caught.message : "No se pudo abrir la foto del Parte Diario",
      })
    } finally {
      setOpeningPdImage(null)
    }
  }

  const start = async () => {
    try {
      const localVisit = (await store.getVisit(visit.id)) ?? visit
      const downloadedCatalogs =
        (contextOf(localVisit) as StoredVisitContext).certificate_catalogs ??
        context.certificate_catalogs
      const pinnedVisit = pinVisitCertificateCatalogs(localVisit, downloadedCatalogs)
      const replacementCatalogVersionId =
        pinnedVisit.pinnedCertificateCatalogs?.replacementCatalogVersion
      if (!replacementCatalogVersionId) throw new Error("No hay una versión de repuestos descargada")
      const currentDeviceId = deviceId()
      if (navigator.onLine) {
        if (pinnedVisit.claimedByDeviceId !== currentDeviceId)
          await coordinator.claimVisit(visit.id, currentDeviceId)
        const reservedVisit = (await store.getVisit(visit.id)) ?? pinnedVisit
        const response = await edgeApi.visits.startVisit(
          visit.id,
          replacementCatalogVersionId,
          currentDeviceId,
        )
        await store.saveVisit({
          ...reservedVisit,
          pinnedCertificateCatalogs: pinnedVisit.pinnedCertificateCatalogs,
          backendStatus: response.visit.estado ?? "en_curso",
          estadoLocal: "en_curso_local",
        })
        setMessage("Visita iniciada con el catálogo de repuestos descargado.")
      } else {
        await coordinator.queue(visit.id, currentDeviceId, "start_visit", {
          replacement_catalog_version_id: replacementCatalogVersionId,
          device_id: currentDeviceId,
        })
        const queuedVisit = (await store.getVisit(visit.id)) ?? pinnedVisit
        await store.saveVisit({
          ...queuedVisit,
          pinnedCertificateCatalogs: pinnedVisit.pinnedCertificateCatalogs,
          estadoLocal: "en_curso_local",
          synchronizationPending: true,
        })
        setMessage("Visita iniciada offline con el catálogo de repuestos descargado.")
      }
      await onChanged()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "No se pudo iniciar la visita")
    }
  }

  const claim = async () => {
    try {
      await coordinator.claimVisit(visit.id, deviceId())
      setMessage("Visita reservada para este dispositivo.")
      await onChanged()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "No se pudo reservar la visita")
    }
  }

  const captureClientSignature = async () => {
    const signerName = clientSigner.trim()
    if (!/^\S+\s+\S+/.test(signerName) || !clientSignature) {
      avisarCliente("Ingresá el nombre y apellido del representante y registrá su firma.", true)
      return
    }
    setSavingClientSignature(true)
    setMessage(undefined)
    try {
      const file = dataUrlToFile(clientSignature, `firma-cliente-${visit.id}.png`)
      let yaRegistrada = false
      if (navigator.onLine) {
        try {
          await edgeApi.certificates.uploadVisitSignature(visit.id, {
            party: "cliente",
            captureMethod: "pwa_cliente_presencial",
            signerName,
            file,
          })
        } catch (caught) {
          // Un intento previo ya la registró (por ejemplo, se cortó la respuesta): se continúa.
          if (!esFirmaYaRegistrada(caught)) throw caught
          yaRegistrada = true
        }
      } else {
        const { signatureOperation } = await queueOfflineSignatureCapture({
          store,
          coordinator,
          visitId: visit.id,
          deviceId: deviceId(),
          party: "cliente",
          signerName,
          file,
          dependencies: await pendingStartOperationIds(store, visit.id),
        })
        setClientSignatureOperationId(signatureOperation.operationId)
      }
      setClientSignatureSaved(true)
      avisarCliente(
        yaRegistrada
          ? "La firma del Cliente ya estaba registrada en el servidor. Ahora puede firmar el Técnico."
          : navigator.onLine
            ? "Firma del Cliente registrada. Ahora puede firmar el Técnico."
            : "Firma del Cliente guardada en el dispositivo. Se sincronizará antes que la firma del Técnico.",
      )
      await onChanged()
    } catch (caught) {
      avisarCliente(textoDeError(caught, "No se pudo registrar la firma del Cliente"), true)
    } finally {
      setSavingClientSignature(false)
    }
  }

  /** Completa la visita; devuelve `true` solo si quedó completada (en el servidor o localmente). */
  const complete = async (): Promise<boolean> => {
    if (!clientSignatureStepDone) {
      avisarCierre("Registrá la firma del Cliente o indicá que no hay un representante presente.", true)
      return false
    }
    if (!technician.trim() || !technicianSignature) {
      avisarCierre(
        "Seleccioná el Técnico ejecutor y registrá su firma antes de completar la visita.",
        true,
      )
      return false
    }
    setCompleting(true)
    avisarCierre("Completando visita…")
    try {
      if (!navigator.onLine) {
        const blocker = visitCompletionBlocker(
          context.work_orders ?? [],
          await store.listOperations(visit.id),
        )
        if (blocker) {
          avisarCierre(blocker, true)
          return false
        }
      }
      const file = dataUrlToFile(technicianSignature, `firma-tecnico-${visit.id}.png`)
      if (navigator.onLine) {
        // Lo encolado sin conexión (firma del Cliente, resultados) tiene que llegar antes del cierre.
        const operations = await store.listOperations(visit.id)
        if (clientSignatureOperationId || operations.some((op) => op.estado !== "sincronizada"))
          await coordinator.sync(visit.id, deviceId())
        if (!hasTechnicianSignature) {
          try {
            await edgeApi.certificates.uploadVisitSignature(visit.id, {
              party: "tecnico",
              signerName: technician,
              file,
            })
          } catch (caught) {
            // Un intento anterior ya subió la firma del Técnico pero el cierre no terminó: el
            // servidor no permite reemplazarla, así que se sigue con el cierre.
            if (!esFirmaYaRegistrada(caught)) throw caught
          }
          setTechnicianSignatureUploaded(true)
        }
        try {
          await edgeApi.visits.transition(visit.id, "complete")
        } catch (caught) {
          // Si la visita ya figura completada (se perdió la respuesta de un intento previo), es éxito.
          if (!(await visitaYaCompletada(visit.id))) throw caught
        }
      } else {
        const { signatureOperation } = await queueOfflineSignatureCapture({
          store,
          coordinator,
          visitId: visit.id,
          deviceId: deviceId(),
          party: "tecnico",
          signerName: technician,
          file,
          dependencies: [
            ...(await pendingStartOperationIds(store, visit.id)),
            ...(clientSignatureOperationId ? [clientSignatureOperationId] : []),
          ],
        })
        await coordinator.queue(
          visit.id,
          deviceId(),
          "complete_visit",
          {
            local_completed_at: new Date().toISOString(),
          },
          [...new Set([
            signatureOperation.operationId,
            ...(await pendingCompletionOperationIds(store, visit.id)),
          ])],
        )
        await coordinator.markVisitLocallyComplete(visit.id)
      }
      avisarCierre(
        navigator.onLine
          ? "Visita completada y enviada al backend."
          : "Visita completada localmente; queda pendiente de sincronización.",
      )
      await onChanged()
      return true
    } catch (caught) {
      avisarCierre(textoDeError(caught, "No se pudo completar la visita"), true)
      return false
    } finally {
      setCompleting(false)
    }
  }

  const completeIncompleteVisit = async () => {
    const reasonText = incompleteReason.trim()
    if (!reasonText) {
      avisarCierre("Indicá el motivo por el cual la visita quedó sin terminar.", true)
      return
    }
    if (!clientSignatureStepDone) {
      avisarCierre("Registrá la firma del Cliente o indicá que no hay un representante presente.", true)
      return
    }
    if (!technician.trim() || !technicianSignature) {
      avisarCierre("Seleccioná el Técnico ejecutor y registrá su firma antes de cerrar la visita.", true)
      return
    }
    setSavingIncomplete(true)
    try {
      const pendingOps = await store.listOperations(visit.id)
      const latestOutcomeByOrder = new Map<string, string>()
      for (const op of pendingOps) {
        if (
          op.kind === "work_order_outcome" &&
          op.estado !== "conflicto" &&
          op.estado !== "fallida" &&
          typeof op.payload.work_order_id === "string" &&
          typeof op.payload.outcome === "string"
        ) {
          latestOutcomeByOrder.set(op.payload.work_order_id, op.payload.outcome)
        }
      }
      const remainingOrders = (context.work_orders ?? []).filter((order) => {
        const effectiveOutcome = latestOutcomeByOrder.get(order.id) ?? order.estado ?? "pendiente"
        return effectiveOutcome === "pendiente"
      })
      const startDeps = await pendingStartOperationIds(store, visit.id)
      for (const order of remainingOrders) {
        if (navigator.onLine) {
          await edgeApi.workOrders.updateWorkOrder(order.id, {
            outcome: "no_evaluada",
            notEvaluatedReason: reasonText,
          })
        } else {
          await coordinator.queue(
            visit.id,
            deviceId(),
            "work_order_outcome",
            {
              work_order_id: order.id,
              outcome: "no_evaluada",
              not_evaluated_reason: reasonText,
            },
            startDeps,
          )
        }
      }
      // Si el cierre falla, `complete` ya dejó el motivo junto al botón: no se lo pisa con un éxito.
      if (!(await complete())) return
      avisarCierre(
        navigator.onLine
          ? "Visita cerrada como no terminada. Las válvulas pendientes quedaron listas para reprogramar por el Administrador."
          : "Visita cerrada localmente como no terminada; al sincronizar se notificará al Administrador para reprogramar las válvulas pendientes.",
      )
    } catch (caught) {
      avisarCierre(textoDeError(caught, "No se pudo cerrar la visita no terminada"), true)
    } finally {
      setSavingIncomplete(false)
    }
  }

  // El aviso se muestra junto a su paso solo si ese paso está a la vista; si no, al pie.
  const lugarDelAviso: Aviso["lugar"] | undefined = !aviso
    ? undefined
    : aviso.lugar === "cierre" && !(started && clientSignatureStepDone)
      ? "general"
      : aviso.lugar === "cliente" && !started
        ? "general"
        : aviso.lugar
  const avisoEn = (lugar: Aviso["lugar"]) =>
    aviso && lugarDelAviso === lugar ? (
      <p
        className={cn("text-sm", aviso.error ? "text-destructive" : "text-muted-foreground")}
        role="status"
      >
        {aviso.texto}
      </p>
    ) : null

  return (
    <div className="space-y-5 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">Trabajo de campo</p>
          <p className="text-sm text-muted-foreground">
            Cada Orden de trabajo tiene un resultado independiente.
          </p>
        </div>
        {!visit.claimedByDeviceId ? (
          <Button variant="outline" className="max-sm:w-full" onClick={() => void claim()}>
            Reservar en este dispositivo
          </Button>
        ) : (
          <Badge variant="outline">Reservada localmente</Badge>
        )}
      </div>
      {!started ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm text-muted-foreground">
            Al iniciar la Visita de servicio se fija la última versión de repuestos descargada.
          </p>
          <Button
            type="button"
            className="max-sm:w-full"
            onClick={() => void start()}
            disabled={!context.certificate_catalogs || closed}
          >
            Iniciar Visita de servicio
          </Button>
          {!context.certificate_catalogs ? (
            <p className="text-xs text-muted-foreground">
              Actualizá la agenda mientras estás online para descargar el catálogo de repuestos.
            </p>
          ) : null}
        </div>
      ) : null}
      {started ? (
        <Card size="sm">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">Parte Diario (Facturación)</CardTitle>
              {savedPdCode ? <Badge variant="outline">PD {savedPdCode}</Badge> : null}
            </div>
            <CardDescription>
              El Parte Diario cubre todas las válvulas revisadas en esta visita y queda vinculado a
              sus certificados.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-1">
                <Label htmlFor={`parte-diario-code-${visit.id}`}>Número de Parte Diario (PD)</Label>
                <Input
                  id={`parte-diario-code-${visit.id}`}
                  value={pdValor}
                  onChange={(event) => {
                    setPdEditado(true)
                    setPdCode(event.target.value)
                  }}
                  placeholder="Ej. PD1234 o 4078"
                  disabled={closed || savingPd}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="max-sm:w-full"
                onClick={() => void saveParteDiarioCode()}
                disabled={closed || savingPd || !pdValor.trim()}
              >
                {savingPd ? "Guardando…" : "Guardar número PD"}
              </Button>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Foto del Parte Diario</p>
              {/* Dos entradas: con `capture` Android abre solo la cámara y oculta la galería. */}
              <div className="grid gap-2 sm:flex">
                {(
                  [
                    { id: `parte-diario-camara-${visit.id}`, texto: "Sacar foto", camara: true },
                    { id: `parte-diario-photo-${visit.id}`, texto: "Elegir de la galería", camara: false },
                  ] as const
                ).map((opcion) => (
                  <label
                    key={opcion.id}
                    htmlFor={opcion.id}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "cursor-pointer focus-within:ring-3 focus-within:ring-ring/50 max-sm:w-full",
                      (closed || savingPd) && "pointer-events-none opacity-50",
                    )}
                  >
                    {opcion.camara ? <Camera /> : <ImagePlus />}
                    {pdPhotoStatus?.tipo === "subiendo" ? "Subiendo…" : opcion.texto}
                    <input
                      id={opcion.id}
                      type="file"
                      accept="image/*"
                      capture={opcion.camara ? "environment" : undefined}
                      disabled={closed || savingPd}
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        void captureParteDiarioPhoto(file)
                        event.currentTarget.value = ""
                      }}
                    />
                  </label>
                ))}
              </div>
              {pdPhotoStatus ? (
                <p
                  aria-live="polite"
                  className={cn(
                    "text-sm",
                    pdPhotoStatus.tipo === "error" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {pdPhotoStatus.texto}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{textoCantidadFotos(pdImagesCount)}</p>
              {pdPhotoList.length ? (
                <ul aria-label="Fotos del Parte Diario" className="grid gap-2 sm:grid-cols-2">
                  {pdPhotoList.map((foto) => (
                    <li
                      key={foto.id}
                      className="flex min-w-0 items-center gap-2 rounded-md border p-2 text-sm"
                    >
                      {foto.origen === "sesion" ? (
                        <>
                          <a href={foto.foto.url} target="_blank" rel="noreferrer" className="shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local (blob:) */}
                            <img
                              src={foto.foto.url}
                              alt={`Parte Diario, foto ${foto.numero}`}
                              className="size-12 rounded border object-cover"
                            />
                          </a>
                          <span className="min-w-0 break-all">
                            Foto {foto.numero}
                            <span className="block text-xs text-muted-foreground">
                              {foto.foto.pendiente ? "Pendiente de sincronizar" : "Subida"}
                            </span>
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1">Foto {foto.numero}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={openingPdImage === foto.id}
                            onClick={() => void openParteDiarioImage(foto.id)}
                          >
                            {openingPdImage === foto.id ? "Abriendo…" : "Ver"}
                          </Button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-3">
        {(context.work_orders ?? []).map((order) => (
          <WorkOrderEditor
            key={order.id}
            order={order}
            visit={visit}
            store={store}
            coordinator={coordinator}
            catalogs={catalogs}
            technicians={technicians}
            disabled={closed || !started}
            onChanged={onChanged}
            onMessage={setMessage}
          />
        ))}
      </div>
      {started ? <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Cierre de la Visita de servicio</CardTitle>
          <CardDescription>
            La firma del Cliente es opcional durante la visita. Si está presente, firma antes que el
            Técnico; si no, podrá firmar luego desde su cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!clientSignatureStepDone ? (
            <section aria-label="Firma del Cliente" className="space-y-3 rounded-md border p-3">
              <h3 className="font-medium">Paso 1 · Firma opcional del Cliente o representante</h3>
              <Label htmlFor={`client-signer-${visit.id}`}>Nombre y apellido</Label>
              <Input
                id={`client-signer-${visit.id}`}
                value={clientSigner}
                onChange={(event) => setClientSigner(event.target.value)}
                placeholder="Nombre y apellido"
                disabled={closed || !started || savingClientSignature}
              />
              <SignaturePad title="Firma del Cliente" onChange={setClientSignature} />
              <p className="text-xs text-muted-foreground">
                Esta firma registra quién firmó y cuándo. No acredita ni reemplaza la autoridad del
                representante. La visita conserva su asociación con el Cliente titular del yacimiento.
              </p>
              <Button
                type="button"
                className="max-sm:w-full"
                onClick={() => void captureClientSignature()}
                disabled={closed || !started || savingClientSignature}
              >
                {savingClientSignature ? "Guardando firma…" : "Registrar firma del Cliente y continuar"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="max-sm:w-full"
                onClick={() => {
                  setClientSignatureSkipped(true)
                  avisarCliente("Se omitió la firma presencial. El Cliente podrá firmar luego desde su cuenta.")
                }}
                disabled={closed || !started || savingClientSignature}
              >
                No hay representante presente · Continuar
              </Button>
            </section>
          ) : clientSignatureSaved ? (
            <p className="rounded-md border bg-muted/30 p-3 text-sm">
              Firma presencial registrada para {clientSigner || "el representante"}.
            </p>
          ) : (
            <p className="rounded-md border bg-muted/30 p-3 text-sm">
              Se omitió la firma presencial. El Cliente podrá firmar después desde su cuenta.
            </p>
          )}
          {avisoEn("cliente")}
          {clientSignatureStepDone ? (
            <section aria-label="Firma del Técnico" className="space-y-3 rounded-md border p-3">
              <h3 className="font-medium">Paso 2 · Firma del Técnico</h3>
              <Label htmlFor={`technician-${visit.id}`}>Técnico ejecutor</Label>
              {technicians.length ? (
                <div className="space-y-2">
                  <SelectNativo
                    id={`technician-${visit.id}`}
                    value={customTechnician ? "__otro__" : technician}
                    onChange={(event) => {
                      const val = event.target.value
                      if (val === "__otro__") {
                        setCustomTechnician(true)
                        setTechnician("")
                        return
                      }
                      setCustomTechnician(false)
                      setTechnician(val)
                    }}
                    disabled={closed || !started}
                  >
                    <option value="">Seleccionar Técnico</option>
                    {technicians.map((person) => (
                      <option key={person.id ?? nombreDeTecnico(person)} value={nombreDeTecnico(person)}>
                        {nombreDeTecnico(person)}
                      </option>
                    ))}
                    <option value="__otro__">Otro técnico / Reemplazo…</option>
                  </SelectNativo>
                  {customTechnician ? (
                    <Input
                      id={`technician-custom-${visit.id}`}
                      value={technician}
                      onChange={(event) => setTechnician(event.target.value)}
                      placeholder="Nombre y apellido del técnico reemplazante"
                      disabled={closed || !started}
                    />
                  ) : null}
                </div>
              ) : (
                <Input
                  id={`technician-${visit.id}`}
                  value={technician}
                  onChange={(event) => setTechnician(event.target.value)}
                  placeholder="Nombre del Técnico ejecutor"
                  disabled={closed || !started}
                />
              )}
              <SignaturePad title="Firma del Técnico" onChange={setTechnicianSignature} />
              <Button
                className="max-sm:w-full"
                onClick={() => void complete()}
                disabled={closed || !started || savingIncomplete || completing}
                aria-busy={completing}
              >
                {closed ? "Visita cerrada" : completing ? "Completando visita…" : "Completar visita"}
              </Button>
              {avisoEn("cierre")}
              <div className="space-y-2 rounded-md border border-dashed bg-muted/20 p-3">
                <p className="text-xs font-medium">
                  ¿No llegaron a revisar todas las válvulas en el día?
                </p>
                <p className="text-xs text-muted-foreground">
                  Al marcar «Visita no terminada», las válvulas que sigan pendientes se registran
                  como no evaluadas con este motivo para que el Administrador reprograme otro día
                  bajo la misma solicitud.
                </p>
                <Input
                  id={`incomplete-reason-${visit.id}`}
                  value={incompleteReason}
                  onChange={(event) => setIncompleteReason(event.target.value)}
                  placeholder="Motivo para reprogramar las válvulas faltantes"
                  disabled={closed || !started || savingIncomplete || completing}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="max-sm:w-full"
                  onClick={() => void completeIncompleteVisit()}
                  disabled={closed || !started || savingIncomplete || completing}
                >
                  {savingIncomplete
                    ? "Cerrando visita…"
                    : "Visita no terminada (reprogramar faltantes)"}
                </Button>
              </div>
            </section>
          ) : null}
          {closed ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" /> Los borradores están cerrados; la sincronización se
              muestra por separado.
            </p>
          ) : null}
        </CardContent>
      </Card> : null}
      {avisoEn("general")}
    </div>
  )
}

function WorkOrderEditor({
  order,
  visit,
  store,
  coordinator,
  catalogs,
  technicians,
  disabled,
  onChanged,
  onMessage,
}: {
  order: CachedWorkOrder
  visit: VisitaOffline
  store: IndexedDbOfflineStore
  coordinator: OfflineSyncCoordinator
  catalogs?: CertificateCaptureCatalogsDto
  technicians: TecnicoAsignado[]
  disabled: boolean
  onChanged: () => Promise<void>
  onMessage: (message: string) => void
}) {
  const [reason, setReason] = useState(order.no_evaluada_razon ?? "")
  const [outcome, setOutcome] = useState(order.estado ?? "pendiente")
  const [certificateId, setCertificateId] = useState<string>(
    order.certificate_id ?? "",
  )
  const [localCertificate, setLocalCertificate] = useState<Record<string, unknown> | undefined>(
    order.certificate ?? undefined,
  )
  const [evidence, setEvidence] = useState<
    Partial<Record<CertificateEvidenceKey, { media_id: string }>>
  >({})
  // Estado y miniatura de cada foto de evidencia; vive acá porque el formulario se vuelve a montar
  // cada vez que el borrador cambia en el servidor.
  const [evidenceStatus, setEvidenceStatus] = useState<
    Partial<Record<CertificateEvidenceKey, EstadoFotoEvidencia>>
  >({})
  const evidenceUrls = useRef<Partial<Record<CertificateEvidenceKey, string>>>({})
  useEffect(() => {
    const urls = evidenceUrls.current
    return () => {
      for (const url of Object.values(urls)) if (url) URL.revokeObjectURL(url)
    }
  }, [])
  const draft = useEdgeCertificateDraft(certificateId || undefined)
  const currentCertificate = draft.data?.certificate ?? localCertificate
  // Si el servidor cambia el estado o el motivo de la orden, se resincroniza durante el render.
  const serverOrderKey = JSON.stringify([order.estado ?? "pendiente", order.no_evaluada_razon ?? ""])
  const [syncedOrderKey, setSyncedOrderKey] = useState(serverOrderKey)
  if (serverOrderKey !== syncedOrderKey) {
    setSyncedOrderKey(serverOrderKey)
    setOutcome(order.estado ?? "pendiente")
    setReason(order.no_evaluada_razon ?? "")
  }

  const snapshot = currentCertificate?.plantilla_snapshot
  const boundTemplate = useMemo(() => {
    if (!catalogs || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      return catalogs?.template
    const parsed = certificateTemplateSchema.safeParse({
      ...catalogs.template,
      ...snapshot,
      estado: "historica",
    })
    return parsed.success ? parsed.data : catalogs.template
  }, [catalogs, snapshot])

  useEffect(() => {
    let cancelled = false
    void store.listOperations(visit.id).then((operations) => {
      const startOperation = operations.find(
        (operation) =>
          operation.kind === "start_certificate_draft" &&
          operation.payload.work_order_id === order.id,
      )
      const queuedCertificateId =
        typeof startOperation?.payload.certificate_id === "string"
          ? startOperation.payload.certificate_id
          : undefined
      const queuedTemplateSnapshot = startOperation?.payload.template_snapshot
      const queuedOutcome = operations
        .filter(
          (operation) =>
            operation.kind === "work_order_outcome" &&
            operation.payload.work_order_id === order.id &&
            operation.estado !== "sincronizada" &&
            (operation.payload.outcome === "evaluada" || operation.payload.outcome === "no_evaluada"),
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.operationId.localeCompare(b.operationId))
        .at(-1)
      const updateOperation = operations
        .filter(
          (operation) =>
            operation.kind === "update_certificate_draft" &&
            operation.payload.certificate_id === (queuedCertificateId ?? certificateId),
        )
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) ||
            a.operationId.localeCompare(b.operationId),
        )
        .at(-1)
      const queuedData = updateOperation?.payload.data
      if (cancelled) return
      if (queuedOutcome?.payload.outcome === "evaluada" || queuedOutcome?.payload.outcome === "no_evaluada")
        setOutcome(queuedOutcome.payload.outcome)
      if (!certificateId && queuedCertificateId) {
        setCertificateId(queuedCertificateId)
        setLocalCertificate((current) => ({
          ...(current ?? {}),
          id: queuedCertificateId,
          estado: "borrador",
          estado_captura: "abierto",
          plantilla_snapshot: queuedTemplateSnapshot,
        }))
      }
      if (queuedData && typeof queuedData === "object" && !Array.isArray(queuedData))
        setLocalCertificate((current) => ({
          ...(current ?? {}),
          ...(queuedData as Record<string, unknown>),
        }))
    })
    return () => {
      cancelled = true
    }
  }, [certificateId, order.id, store, visit.id])

  const updateOutcome = async (outcome: "evaluada" | "no_evaluada") => {
    if (disabled) return
    try {
      if (navigator.onLine) {
        await edgeApi.workOrders.updateWorkOrder(order.id, {
          outcome,
          notEvaluatedReason: outcome === "no_evaluada" ? reason : undefined,
        })
      } else {
        const dependencies = await pendingStartOperationIds(store, visit.id)
        await coordinator.queue(visit.id, deviceId(), "work_order_outcome", {
          work_order_id: order.id,
          outcome,
          not_evaluated_reason: outcome === "no_evaluada" ? reason : null,
        }, dependencies)
      }
      setOutcome(outcome)
      onMessage(
        outcome === "evaluada"
          ? "Orden de trabajo marcada como evaluada."
          : "Orden de trabajo marcada como no evaluada.",
      )
      await onChanged()
    } catch (caught) {
      onMessage(caught instanceof Error ? caught.message : "No se pudo guardar el resultado")
    }
  }

  const startDraft = async () => {
    try {
      if (navigator.onLine) {
        const result = await edgeApi.certificates.startCertificateDraft(order.id)
        setCertificateId(result.certificate.id)
        setLocalCertificate(result.certificate)
      } else {
        const localId = window.crypto.randomUUID()
        const resolvedValve = findValve(contextOf(visit), order.valvula_id, order)
        setCertificateId(localId)
        setLocalCertificate({
          id: localId,
          estado: "borrador",
          estado_captura: "abierto",
          ...(resolvedValve ? { contexto_captura: { valvula: resolvedValve } } : {}),
          plantilla_version: catalogs?.template.version,
          plantilla_snapshot: catalogs
            ? {
                id: catalogs.template.id,
                version: catalogs.template.version,
                campos: catalogs.template.campos,
              }
            : undefined,
        })
        await coordinator.queue(
          visit.id,
          deviceId(),
          "start_certificate_draft",
          {
            work_order_id: order.id,
            certificate_id: localId,
            template_snapshot: catalogs
              ? {
                  id: catalogs.template.id,
                  version: catalogs.template.version,
                  campos: catalogs.template.campos,
                }
              : null,
          },
          await pendingStartOperationIds(store, visit.id),
        )
      }
      onMessage("Borrador de certificado iniciado.")
      await onChanged()
    } catch (caught) {
      onMessage(caught instanceof Error ? caught.message : "No se pudo iniciar el borrador")
    }
  }

  const saveDraft = async (
    entrada: Parameters<NonNullable<ComponentProps<typeof CertificateCaptureForm>["onSave"]>>[0],
  ) => {
    if (!certificateId || disabled) return
    try {
      // Las fotos de esta sesión que ya se subieron viajan con su referencia de Storage y no como
      // `{ media_id }`, para no pisar la evidencia que el servidor ya registró (P2).
      const operations = await store.listOperations(visit.id)
      const payload = resolverEvidenciaDelBorrador(entrada, referenciasDeEvidencia(operations))
      if (navigator.onLine) await edgeApi.certificates.updateDraft(certificateId, payload)
      else {
        const priorOperations = operations
          .filter(
            (operation) =>
              operation.payload.certificate_id === certificateId &&
              ["start_certificate_draft", "update_certificate_draft"].includes(operation.kind),
          )
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        const previous = priorOperations.at(-1)
        const dependencies = await pendingStartOperationIds(store, visit.id)
        if (previous) dependencies.push(previous.operationId)
        await coordinator.queue(
          visit.id,
          deviceId(),
          "update_certificate_draft",
          { certificate_id: certificateId, data: payload },
          [...new Set(dependencies)],
        )
      }
      setLocalCertificate((current) => ({ ...(current ?? {}), ...payload }))
      onMessage("Borrador guardado.")
      await onChanged()
    } catch (caught) {
      console.error("[saveDraft error]", caught)
      onMessage(caught instanceof Error ? caught.message : "No se pudo guardar el borrador")
    }
  }

  const capturePhoto = async (section: CertificateEvidenceKey, picked: File | undefined) => {
    if (!picked || disabled) return
    const sectionLabel =
      CERTIFICATE_EVIDENCE_SECTIONS.find(({ key }) => key === section)?.label ?? section
    setEvidenceStatus((current) => ({
      ...current,
      [section]: { estado: "guardando", nombre: picked.name },
    }))
    try {
      // Convierte HEIC y reduce las fotos pesadas: el servidor solo acepta JPG, PNG o WEBP ≤ 10 MB.
      const file = await prepararImagen(picked)
      const mediaId = window.crypto.randomUUID()
      const fileName = file.name || `evidencia-${mediaId}.jpg`
      await store.saveMedia?.({
        id: mediaId,
        mediaId,
        visitId: visit.id,
        operationId: mediaId,
        kind: "photo",
        blob: file,
        file,
        contentType: file.type,
        fileName,
        createdAt: new Date().toISOString(),
      })
      setEvidence((current) => ({ ...current, [section]: { media_id: mediaId } }))
      await coordinator.queue(
        visit.id,
        deviceId(),
        "upload_photo",
        {
          media_id: mediaId,
          certificate_id: certificateId || null,
          category: section,
          content_type: file.type,
        },
        await pendingStartOperationIds(store, visit.id),
        { mediaIds: [mediaId] },
      )
      const previousUrl = evidenceUrls.current[section]
      if (previousUrl) URL.revokeObjectURL(previousUrl)
      const vistaPrevia = URL.createObjectURL(file)
      evidenceUrls.current[section] = vistaPrevia
      setEvidenceStatus((current) => ({
        ...current,
        [section]: { estado: "lista", nombre: fileName, vistaPrevia },
      }))
      onMessage(`Foto «${sectionLabel}» guardada localmente y lista para sincronizar.`)
    } catch (caught) {
      const mensaje = caught instanceof Error ? caught.message : "No se pudo guardar la foto"
      setEvidenceStatus((current) => ({ ...current, [section]: { estado: "error", mensaje } }))
      onMessage(mensaje)
      return
    }
    await onChanged()
  }

  return (
    <Card size="sm" className="overflow-visible bg-muted/20">
      <CardHeader>
        <CardTitle className="text-sm">
          {workOrderName(order, contextOf(visit), currentCertificate)}
        </CardTitle>
        <CardDescription>Estado: {outcome}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => void updateOutcome("evaluada")}
          >
            Evaluada
          </Button>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => void updateOutcome("no_evaluada")}
          >
            No evaluada
          </Button>
        </div>
        <Input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Motivo si no fue evaluada"
          disabled={disabled}
        />
        {!certificateId ? (
          <Button
            variant="secondary"
            className="max-sm:w-full"
            disabled={disabled || outcome !== "evaluada" || !catalogs}
            onClick={() => void startDraft()}
          >
            <FileCheck2 className="mr-2 size-4" /> Iniciar Borrador de certificado
          </Button>
        ) : null}
        {certificateId ? (
          <div className="space-y-3 rounded-md border bg-background p-2 sm:p-3">
            <p className="text-sm font-medium break-all">Borrador de certificado · {certificateId}</p>
            {catalogs && boundTemplate ? (
              <CertificateCaptureForm
                key={`${certificateId}-${String(draft.data?.certificate.updated_at ?? "local")}`}
                template={boundTemplate}
                catalogs={catalogs}
                technicians={technicians}
                certificate={currentCertificate}
                valve={findValve(contextOf(visit), order.valvula_id, order, currentCertificate)}
                evidence={evidence}
                evidenceStatus={evidenceStatus}
                disabled={disabled}
                onCapturePhoto={(section, file) => void capturePhoto(section, file)}
                onSave={(payload) => void saveDraft(payload)}
              />
            ) : (
              <Cargando variante="linea" texto="Cargando la plantilla y catálogos del certificado…" />
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
