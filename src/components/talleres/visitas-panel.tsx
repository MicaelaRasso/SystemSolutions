"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, ChevronUp, CloudOff, FileCheck2, Lock, RefreshCw, Wifi } from "lucide-react"

import { SignaturePad, dataUrlToFile } from "@/components/certificados/signature-pad"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { edgeApi } from "@/lib/api"
import {
  buildCertificateDraftPayload,
  CERTIFICATE_EVIDENCE_SECTIONS,
  type CertificateEvidenceKey,
} from "@/lib/api/certificates"
import type { VisitDto, WorkOrderDetailDto } from "@/lib/api/contracts"
import {
  IndexedDbOfflineStore,
  OfflineSyncCoordinator,
  queueOfflineSignatureCapture,
  type OperacionOffline,
  type VisitaOffline,
} from "@/lib/offline/sync"

const DEVICE_ID_STORAGE_KEY = "systemsolutions.offline.device-id"

type StoredVisitContext = VisitDto & {
  context?: unknown
  assigned_technicians?: { id?: string; name?: string; nombre?: string }[]
}

function deviceId() {
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)
  if (existing) return existing
  const value = window.crypto.randomUUID()
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, value)
  return value
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
            kind: operation.kind as Parameters<typeof edgeApi.offline.syncVisit>[1]["operations"][number]["kind"],
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
      const workingSet = await edgeApi.offline.workingSet()
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
        await store.saveVisit({
          id: entry.visit.id,
          context: entry,
          cachedAt: new Date().toISOString(),
          estadoLocal: old?.estadoLocal ?? "disponible",
          synchronizationPending: old?.synchronizationPending ?? false,
          claimedByDeviceId: old?.claimedByDeviceId,
          claimedAt: old?.claimedAt,
        })
        const pending = (await store.listOperations(entry.visit.id)).some(
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
          {connection === "offline" ? "Trabajando offline" : connection === "loading" ? "Actualizando…" : "Conectado"}
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={connection === "loading"}>
          <RefreshCw className="mr-2 size-4" /> Actualizar agenda
        </Button>
      </div>
      {error ? <ErrorState error={error} onRetry={() => void refresh()} /> : null}
      {visits.length === 0 && connection !== "loading" ? (
        <EmptyState titulo="No hay visitas de servicio disponibles" descripcion="La agenda de los próximos dos días aparecerá aquí después de una autenticación online." />
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
          <Badge variant={conflicts.length ? "destructive" : visit.estadoLocal === "completada_local" ? "secondary" : "outline"}>
            {conflicts.length ? "Conflicto" : visit.estadoLocal === "completada_local" ? "Completada localmente" : pending.length ? "Pendiente de sincronización" : "Disponible"}
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
            Conflicto de sincronización: se conservan los datos locales para resolución administrativa.
            {conflicts.map((operation) => <p key={operation.operationId}>{operation.lastError}</p>)}
          </div>
        ) : null}
        {failed.length ? <p className="text-sm text-destructive">Hay cambios fallidos. Podés reintentar sin volver a capturar el trabajo.</p> : null}
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
  const closed = visit.estadoLocal === "completada_local"

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
        })
        await coordinator.queue(visit.id, deviceId(), "complete_visit", {
          local_completed_at: new Date().toISOString(),
        }, [signatureOperation.operationId])
        await coordinator.markVisitLocallyComplete(visit.id)
      }
      setMessage(navigator.onLine ? "Visita completada y enviada al backend." : "Visita completada localmente; queda pendiente de sincronización.")
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
          <p className="text-sm text-muted-foreground">Cada Orden de trabajo tiene un resultado independiente.</p>
        </div>
        {!visit.claimedByDeviceId ? <Button variant="outline" onClick={() => void claim()}>Reservar en este dispositivo</Button> : <Badge variant="outline">Reservada localmente</Badge>}
      </div>
      <div className="space-y-3">
        {(context.work_orders ?? []).map((order) => (
          <WorkOrderEditor key={order.id} order={order} visit={visit} store={store} coordinator={coordinator} disabled={closed} onChanged={onChanged} onMessage={setMessage} />
        ))}
      </div>
      <Card size="sm">
        <CardHeader><CardTitle className="text-sm">Cierre de la Visita de servicio</CardTitle><CardDescription>La firma del Técnico es obligatoria. La firma del Cliente puede llegar después desde su panel.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor={`technician-${visit.id}`}>Técnico ejecutor</Label>
          {technicians.length ? (
            <select id={`technician-${visit.id}`} className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm" value={technician} onChange={(event) => setTechnician(event.target.value)} disabled={closed}>
              <option value="">Seleccionar Técnico</option>
              {technicians.map((person) => <option key={person.id ?? person.name ?? person.nombre} value={person.name ?? person.nombre ?? ""}>{person.name ?? person.nombre}</option>)}
            </select>
          ) : <Input id={`technician-${visit.id}`} value={technician} onChange={(event) => setTechnician(event.target.value)} placeholder="Nombre del Técnico ejecutor" disabled={closed} />}
          <SignaturePad title="Firma del Técnico" onChange={setSignature} />
          <Button onClick={() => void complete()} disabled={closed}>{closed ? "Visita cerrada" : "Completar visita"}</Button>
          {closed ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Lock className="size-4" /> Los borradores están cerrados; la sincronización se muestra por separado.</p> : null}
        </CardContent>
      </Card>
      {message ? <p className="text-sm text-muted-foreground" role="status">{message}</p> : null}
    </div>
  )
}

function WorkOrderEditor({
  order,
  visit,
  store,
  coordinator,
  disabled,
  onChanged,
  onMessage,
}: {
  order: WorkOrderDetailDto
  visit: VisitaOffline
  store: IndexedDbOfflineStore
  coordinator: OfflineSyncCoordinator
  disabled: boolean
  onChanged: () => Promise<void>
  onMessage: (message: string) => void
}) {
  const [reason, setReason] = useState(order.no_evaluada_razon ?? "")
  const [certificateId, setCertificateId] = useState<string>(String((order as Record<string, unknown>).certificate_id ?? ""))
  const [draft, setDraft] = useState({ observations: "", maintenanceScope: "", replacementParts: "", otherParts: "" })
  const [evidence, setEvidence] = useState<Partial<Record<CertificateEvidenceKey, { media_id: string }>>>({})

  const updateOutcome = async (outcome: "evaluada" | "no_evaluada") => {
    if (disabled) return
    try {
      if (navigator.onLine) {
        await edgeApi.workOrders.updateWorkOrder(order.id, { outcome, notEvaluatedReason: outcome === "no_evaluada" ? reason : undefined })
      } else {
        await coordinator.queue(visit.id, deviceId(), "work_order_outcome", { work_order_id: order.id, outcome, not_evaluated_reason: outcome === "no_evaluada" ? reason : null })
      }
      onMessage(outcome === "evaluada" ? "Orden de trabajo marcada como evaluada." : "Orden de trabajo marcada como no evaluada.")
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
      } else {
        await coordinator.queue(visit.id, deviceId(), "start_certificate_draft", { work_order_id: order.id })
      }
      onMessage("Borrador de certificado iniciado.")
      await onChanged()
    } catch (caught) {
      onMessage(caught instanceof Error ? caught.message : "No se pudo iniciar el borrador")
    }
  }

  const saveDraft = async () => {
    if (!certificateId || disabled) return
    try {
      const payload = buildCertificateDraftPayload({
        catalogVersion: String((order as Record<string, unknown>).repuestos_catalog_version ?? "SYS_Certificado_Modelo1"),
        maintenanceScope: draft.maintenanceScope.split(",").map((value) => value.trim()).filter(Boolean),
        replacementPartIds: draft.replacementParts.split(",").map((value) => value.trim()).filter(Boolean),
        otherParts: draft.otherParts,
        observations: draft.observations,
        evidence,
      })
      if (navigator.onLine) await edgeApi.certificates.updateDraft(certificateId, payload)
      else await coordinator.queue(visit.id, deviceId(), "update_certificate_draft", { certificate_id: certificateId, ...payload })
      onMessage("Borrador guardado.")
      await onChanged()
    } catch (caught) {
      onMessage(caught instanceof Error ? caught.message : "No se pudo guardar el borrador")
    }
  }

  const capturePhoto = async (section: CertificateEvidenceKey, file: File | undefined) => {
    if (!file || disabled) return
    const mediaId = window.crypto.randomUUID()
    await store.saveMedia?.({ id: mediaId, mediaId, visitId: visit.id, operationId: mediaId, kind: "photo", blob: file, file, contentType: file.type, fileName: file.name, createdAt: new Date().toISOString() })
    setEvidence((current) => ({ ...current, [section]: { media_id: mediaId } }))
    await coordinator.queue(visit.id, deviceId(), "upload_photo", { media_id: mediaId, certificate_id: certificateId || null, category: section, content_type: file.type }, [], { mediaIds: [mediaId] })
    onMessage(`Foto de ${section} guardada localmente y lista para sincronizar.`)
    await onChanged()
  }

  return (
    <Card size="sm" className="bg-muted/20">
      <CardHeader><CardTitle className="text-sm">{workOrderName(order, contextOf(visit))}</CardTitle><CardDescription>Estado: {order.estado ?? "pendiente"}</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void updateOutcome("evaluada")}>Evaluada</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void updateOutcome("no_evaluada")}>No evaluada</Button>
        </div>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo si no fue evaluada" disabled={disabled} />
        {!certificateId ? <Button size="sm" variant="secondary" disabled={disabled || order.estado !== "evaluada"} onClick={() => void startDraft()}><FileCheck2 className="mr-2 size-4" /> Iniciar Borrador de certificado</Button> : null}
        {certificateId ? (
          <div className="space-y-3 rounded-md border bg-background p-3">
            <p className="text-sm font-medium">Borrador de certificado · {certificateId}</p>
            <Textarea value={draft.observations} onChange={(event) => setDraft((current) => ({ ...current, observations: event.target.value }))} placeholder="Observaciones del campo" disabled={disabled} />
            <Input value={draft.maintenanceScope} onChange={(event) => setDraft((current) => ({ ...current, maintenanceScope: event.target.value }))} placeholder="Alcance de mantenimiento (separado por coma)" disabled={disabled} />
            <Input value={draft.replacementParts} onChange={(event) => setDraft((current) => ({ ...current, replacementParts: event.target.value }))} placeholder="IDs de categorías de Repuestos (separados por coma)" disabled={disabled} />
            <Input value={draft.otherParts} onChange={(event) => setDraft((current) => ({ ...current, otherParts: event.target.value }))} placeholder="Otros repuestos (opcional)" disabled={disabled} />
            <div className="grid gap-2 sm:grid-cols-3">
              {CERTIFICATE_EVIDENCE_SECTIONS.map(({ key, label }) => <Label key={key} className="rounded-md border p-2 text-xs"><span>{label}</span><Input type="file" accept="image/*" className="mt-2 h-auto" onChange={(event) => void capturePhoto(key, event.target.files?.[0])} disabled={disabled} /></Label>)}
            </div>
            <Button size="sm" onClick={() => void saveDraft()} disabled={disabled}>Guardar Borrador de certificado</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
