"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react"
import { ChevronDown, ChevronUp, CloudOff, FileCheck2, Lock, RefreshCw, Wifi } from "lucide-react"

import { SignaturePad, dataUrlToFile } from "@/components/certificados/signature-pad"
import { CertificateCaptureForm } from "@/components/certificados/certificate-capture-form"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { edgeApi } from "@/lib/api"
import { type CertificateEvidenceKey } from "@/lib/api/certificates"
import { useEdgeCertificateCaptureCatalogs, useEdgeCertificateDraft } from "@/lib/api/hooks"
import type {
  CertificateCaptureCatalogsDto,
  VisitDto,
  WorkOrderDetailDto,
} from "@/lib/api/contracts"
import { certificateTemplateSchema } from "@/lib/api/contracts"
import {
  IndexedDbOfflineStore,
  OfflineSyncCoordinator,
  certificateCatalogsForVisit,
  pinVisitCertificateCatalogs,
  queueOfflineSignatureCapture,
  refreshedVisitCatalogs,
  syncPendingVisitStartsBeforeRefresh,
  type OperacionOffline,
  type VisitaOffline,
} from "@/lib/offline/sync"
import { visitCompletionBlocker } from "@/lib/offline/completion"
import { getOfflineDeviceId as deviceId } from "@/lib/offline/device"

type StoredVisitContext = VisitDto & {
  context?: unknown
  assigned_technicians?: { id?: string; name?: string; nombre?: string }[]
  certificate_catalogs?: CertificateCaptureCatalogsDto
}

type CachedWorkOrder = WorkOrderDetailDto & {
  certificate_id?: string | null
  certificate?: Record<string, unknown> | null
}

function contextOf(visit: VisitaOffline) {
  return (visit.context ?? {}) as StoredVisitContext
}

function visitName(visit: VisitaOffline) {
  const context = contextOf(visit)
  const row = context.visit as Record<string, unknown> | undefined
  return String(row?.yacimiento_nombre ?? row?.yacimiento ?? row?.nombre ?? `Visita ${visit.id}`)
}

function visitDate(visit: VisitaOffline) {
  const row = contextOf(visit).visit as Record<string, unknown> | undefined
  const value = row?.starts_at ?? row?.fecha_inicio ?? row?.fecha_ejecucion
  return typeof value === "string" ? new Date(value).toLocaleString("es-AR") : "Fecha no informada"
}

function workOrderName(order: WorkOrderDetailDto, context: StoredVisitContext) {
  const entry = context as unknown as { work_orders?: { valvula?: { nombre?: string } }[] }
  const valve = entry.work_orders?.find((item) => item === order)?.valvula
  return String(valve?.nombre ?? order.valvula_id ?? order.id)
}

function findValve(context: StoredVisitContext, valveId: string | undefined) {
  const tree = context.context as { valvulas?: Record<string, unknown>[] } | undefined
  return tree?.valvulas?.find((valve) => valve.id === valveId)
}

function createCoordinator(store: IndexedDbOfflineStore) {
  return new OfflineSyncCoordinator(store, {
    async uploadMedia({ visitId, deviceId, operationId, mediaId, kind, party, category }) {
      const media = await store.getMedia(mediaId)
      if (!media) throw new Error("El archivo multimedia no está disponible en IndexedDB")
      return edgeApi.offline.uploadMedia(visitId, {
        deviceId,
        operationId,
        mediaId,
        kind,
        party,
        category,
        file: (media.file ?? media.blob) as Blob,
        fileName: media.fileName,
      })
    },
    async syncVisit(visitId, operations, currentDeviceId) {
      const response = await edgeApi.offline.syncVisit(visitId, {
        deviceId: currentDeviceId,
        operations: operations.map((raw) => {
          const operation = raw as {
            operation_id: string
            kind: string
            payload: Record<string, unknown>
            schema_version: number
            dependencies: string[]
            device_timestamp: string
            idempotency_key?: string
            base_versions?: Record<string, number>
          }
          return {
            operationId: operation.operation_id,
            kind: operation.kind as Parameters<
              typeof edgeApi.offline.syncVisit
            >[1]["operations"][number]["kind"],
            payload: operation.payload,
            schemaVersion: operation.schema_version,
            dependencies: operation.dependencies,
            deviceTimestamp: operation.device_timestamp,
            idempotencyKey: operation.idempotency_key,
            baseVersions: operation.base_versions,
          }
        }),
      })
      return {
        operations: response.operations,
        visit_acknowledgement: response.visit_acknowledgement,
      }
    },
    claimVisit: (visitId, currentDeviceId) => edgeApi.offline.claimVisit(visitId, currentDeviceId),
  })
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
  const [operations, setOperations] = useState<Record<string, OperacionOffline[]>>({})
  const [selectedId, setSelectedId] = useState<string>()
  const [connection, setConnection] = useState<"online" | "offline" | "loading" | "error">(
    typeof navigator !== "undefined" && navigator.onLine ? "loading" : "offline",
  )
  const [error, setError] = useState<string>()

  const loadLocal = useCallback(async () => {
    const store = new IndexedDbOfflineStore()
    const cached = await store.listVisits()
    setVisits(cached.sort((a, b) => a.cachedAt.localeCompare(b.cachedAt)))
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
      const workingSet = await edgeApi.offline.workingSet(deviceId())
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
        const pendingOperations = await store.listOperations(entry.visit.id)
        const entryCatalogs = entry.certificate_catalogs ?? workingSet.certificate_catalogs
        const catalogState = refreshedVisitCatalogs({
          previous: old,
          refreshedContext: { ...entry, certificate_catalogs: entryCatalogs },
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
        const pending = pendingOperations.some(
          (operation) => operation.estado !== "sincronizada",
        )
        if (pending) await createCoordinator(store).sync(entry.visit.id, deviceId())
      }
      await loadLocal()
      setConnection("online")
    } catch (caught) {
      setConnection("error")
      setError(caught instanceof Error ? caught.message : "No se pudo cargar la agenda de campo")
      await loadLocal()
    }
  }, [loadLocal])

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
          {connection === "offline" ? <CloudOff className="size-4" /> : <Wifi className="size-4" />}
          {connection === "offline"
            ? "Trabajando offline"
            : connection === "loading"
              ? "Actualizando…"
              : "Conectado"}
        </div>
        <Button
          variant="outline"
          onClick={() => void refresh()}
          disabled={connection === "loading"}
        >
          <RefreshCw className="mr-2 size-4" /> Actualizar agenda
        </Button>
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refresh()} /> : null}
      {visits.length === 0 && connection !== "loading" ? (
        <EmptyState
          titulo="No hay visitas de servicio disponibles"
          descripcion="La agenda de los próximos dos días aparecerá aquí después de una autenticación online."
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {visits.map((visit) => (
          <VisitCard
            key={visit.id}
            visit={visit}
            operations={operations[visit.id] ?? []}
            open={selectedId === visit.id}
            onOpen={() => setSelectedId(selectedId === visit.id ? undefined : visit.id)}
            onChanged={loadLocal}
          />
        ))}
      </div>
      {selected ? <div className="sr-only">Visita seleccionada: {selected.id}</div> : null}
    </div>
  )
}

function VisitCard({
  visit,
  operations,
  open,
  onOpen,
  onChanged,
}: {
  visit: VisitaOffline
  operations: OperacionOffline[]
  open: boolean
  onOpen: () => void
  onChanged: () => Promise<void>
}) {
  const store = useMemo(() => new IndexedDbOfflineStore(), [])
  const context = contextOf(visit)
  const pending = operations.filter((operation) => operation.estado !== "sincronizada")
  const conflicts = operations.filter((operation) => operation.estado === "conflicto")
  const failed = operations.filter((operation) => operation.estado === "fallida")

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{visitName(visit)}</CardTitle>
            <CardDescription>{visitDate(visit)} · Visita de servicio</CardDescription>
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
        <p className="text-xs text-muted-foreground">ID de visita: {visit.id}</p>
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
          <p className="text-sm text-destructive">
            Hay cambios fallidos. Podés reintentar sin volver a capturar el trabajo.
          </p>
        ) : null}
        <Button variant="outline" onClick={onOpen}>
          {open ? <ChevronUp className="mr-2 size-4" /> : <ChevronDown className="mr-2 size-4" />}
          {open ? "Cerrar visita" : "Abrir visita"}
        </Button>
        {open ? <VisitEditor visit={visit} store={store} onChanged={onChanged} /> : null}
      </CardContent>
    </Card>
  )
}

function VisitEditor({
  visit,
  store,
  onChanged,
}: {
  visit: VisitaOffline
  store: IndexedDbOfflineStore
  onChanged: () => Promise<void>
}) {
  const [message, setMessage] = useState<string>()
  const [technician, setTechnician] = useState("")
  const [signature, setSignature] = useState<string>()
  const context = contextOf(visit)
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
  const started =
    visit.estadoLocal === "en_curso_local" ||
    visit.backendStatus === "en_curso" ||
    context.visit?.estado === "en_curso"

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

  const complete = async () => {
    if (!technician.trim() || !signature) {
      setMessage("Seleccioná el Técnico ejecutor y registrá su firma antes de completar la visita.")
      return
    }
    try {
      if (!navigator.onLine) {
        const blocker = visitCompletionBlocker(
          context.work_orders ?? [],
          await store.listOperations(visit.id),
        )
        if (blocker) {
          setMessage(blocker)
          return
        }
      }
      const file = dataUrlToFile(signature, `firma-tecnico-${visit.id}.png`)
      if (navigator.onLine) {
        await edgeApi.certificates.uploadVisitSignature(visit.id, {
          party: "tecnico",
          signerName: technician,
          file,
        })
        await edgeApi.visits.transition(visit.id, "complete")
      } else {
        const { signatureOperation } = await queueOfflineSignatureCapture({
          store,
          coordinator,
          visitId: visit.id,
          deviceId: deviceId(),
          party: "tecnico",
          signerName: technician,
          file,
          dependencies: await pendingStartOperationIds(store, visit.id),
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
      setMessage(
        navigator.onLine
          ? "Visita completada y enviada al backend."
          : "Visita completada localmente; queda pendiente de sincronización.",
      )
      await onChanged()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "No se pudo completar la visita")
    }
  }

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
          <Button variant="outline" onClick={() => void claim()}>
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
            La firma del Técnico es obligatoria. La firma del Cliente puede llegar después desde su
            panel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor={`technician-${visit.id}`}>Técnico ejecutor</Label>
          {technicians.length ? (
            <select
              id={`technician-${visit.id}`}
              className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
              value={technician}
              onChange={(event) => setTechnician(event.target.value)}
              disabled={closed || !started}
            >
              <option value="">Seleccionar Técnico</option>
              {technicians.map((person) => (
                <option
                  key={person.id ?? person.name ?? person.nombre}
                  value={person.name ?? person.nombre ?? ""}
                >
                  {person.name ?? person.nombre}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`technician-${visit.id}`}
              value={technician}
              onChange={(event) => setTechnician(event.target.value)}
              placeholder="Nombre del Técnico ejecutor"
              disabled={closed || !started}
            />
          )}
          <SignaturePad title="Firma del Técnico" onChange={setSignature} />
          <Button onClick={() => void complete()} disabled={closed || !started}>
            {closed ? "Visita cerrada" : "Completar visita"}
          </Button>
          {closed ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4" /> Los borradores están cerrados; la sincronización se
              muestra por separado.
            </p>
          ) : null}
        </CardContent>
      </Card> : null}
      {message ? (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
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
  technicians: { id?: string; name?: string; nombre?: string }[]
  disabled: boolean
  onChanged: () => Promise<void>
  onMessage: (message: string) => void
}) {
  const [reason, setReason] = useState(order.no_evaluada_razon ?? "")
  const [certificateId, setCertificateId] = useState<string>(
    order.certificate_id ?? "",
  )
  const [localCertificate, setLocalCertificate] = useState<Record<string, unknown> | undefined>(
    order.certificate ?? undefined,
  )
  const [evidence, setEvidence] = useState<
    Partial<Record<CertificateEvidenceKey, { media_id: string }>>
  >({})
  const draft = useEdgeCertificateDraft(certificateId || undefined)
  const currentCertificate = draft.data?.certificate ?? localCertificate
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
        setCertificateId(localId)
        setLocalCertificate({
          id: localId,
          estado: "borrador",
          estado_captura: "abierto",
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
    payload: Parameters<NonNullable<ComponentProps<typeof CertificateCaptureForm>["onSave"]>>[0],
  ) => {
    if (!certificateId || disabled) return
    try {
      if (navigator.onLine) await edgeApi.certificates.updateDraft(certificateId, payload)
      else {
        const priorOperations = (await store.listOperations(visit.id))
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
      onMessage(caught instanceof Error ? caught.message : "No se pudo guardar el borrador")
    }
  }

  const capturePhoto = async (section: CertificateEvidenceKey, file: File | undefined) => {
    if (!file || disabled) return
    const mediaId = window.crypto.randomUUID()
    await store.saveMedia?.({
      id: mediaId,
      mediaId,
      visitId: visit.id,
      operationId: mediaId,
      kind: "photo",
      blob: file,
      file,
      contentType: file.type,
      fileName: file.name,
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
    onMessage(`Foto de ${section} guardada localmente y lista para sincronizar.`)
    await onChanged()
  }

  return (
    <Card size="sm" className="bg-muted/20">
      <CardHeader>
        <CardTitle className="text-sm">{workOrderName(order, contextOf(visit))}</CardTitle>
        <CardDescription>Estado: {order.estado ?? "pendiente"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void updateOutcome("evaluada")}
          >
            Evaluada
          </Button>
          <Button
            size="sm"
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
            size="sm"
            variant="secondary"
            disabled={disabled || order.estado !== "evaluada" || !catalogs}
            onClick={() => void startDraft()}
          >
            <FileCheck2 className="mr-2 size-4" /> Iniciar Borrador de certificado
          </Button>
        ) : null}
        {certificateId ? (
          <div className="space-y-3 rounded-md border bg-background p-3">
            <p className="text-sm font-medium">Borrador de certificado · {certificateId}</p>
            {catalogs && boundTemplate ? (
              <CertificateCaptureForm
                key={`${certificateId}-${String(draft.data?.certificate.updated_at ?? "local")}`}
                template={boundTemplate}
                catalogs={catalogs}
                technicians={technicians}
                certificate={currentCertificate}
                valve={findValve(contextOf(visit), order.valvula_id)}
                evidence={evidence}
                disabled={disabled}
                onCapturePhoto={(section, file) => void capturePhoto(section, file)}
                onSave={(payload) => void saveDraft(payload)}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Cargando la plantilla y catálogos del certificado…
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
