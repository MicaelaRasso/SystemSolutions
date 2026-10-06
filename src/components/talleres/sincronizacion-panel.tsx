"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { edgeApi, type SyncVisitInput } from "@/lib/api"
import {
  IndexedDbOfflineStore,
  OfflineSyncCoordinator,
  refreshedVisitCatalogs,
  syncPendingVisitStartsBeforeRefresh,
  type OperacionOffline,
  type VisitaOffline,
} from "@/lib/offline/sync"
import { getOfflineDeviceId } from "@/lib/offline/device"

type EstadoConexion = "online" | "offline" | "actualizando" | "error"
type OperacionesPorVisita = Record<string, OperacionOffline[]>
type ConflictOutcome = {
  conflict_id: string
  operation_id: string
  visit_id: string
  operation_kind: string
  resolution_action: "accepted" | "rejected" | "correction_authorized"
  resolution_reason: string
  resolved_at: string
}

function createCoordinator(store: IndexedDbOfflineStore) {
  return new OfflineSyncCoordinator(store, {
    async syncVisit(visitId, operations, deviceId) {
      const response = await edgeApi.offline.syncVisit(visitId, {
        deviceId,
        operations: operations.map((rawOperation) => {
          const operation = rawOperation as {
            operation_id: string
            kind: string
            payload: Record<string, unknown>
            schema_version: number
            dependencies: string[]
            device_timestamp: string
          }
          return {
            operationId: operation.operation_id,
            kind: operation.kind as SyncVisitInput["operations"][number]["kind"],
            payload: operation.payload,
            schemaVersion: operation.schema_version,
            dependencies: operation.dependencies,
            deviceTimestamp: operation.device_timestamp,
          }
        }),
      })

      return {
        operations: response.operations.map((operation) => ({
          operation_id: operation.operation_id,
          estado: operation.estado,
          result: operation.result,
          error_message: operation.error_message,
        })),
      }
    },
  })
}

export function SincronizacionPanel() {
  const [connection, setConnection] = useState<EstadoConexion>(() =>
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
  )
  const [visits, setVisits] = useState<VisitaOffline[]>([])
  const [operationsByVisit, setOperationsByVisit] = useState<OperacionesPorVisita>({})
  const [syncingVisits, setSyncingVisits] = useState<string[]>([])
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({})
  const [conflictOutcomes, setConflictOutcomes] = useState<ConflictOutcome[]>([])
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) {
      setConnection("offline")
      return
    }
    setConnection("actualizando")
    setError(undefined)
    try {
      const store = new IndexedDbOfflineStore()
      await syncPendingVisitStartsBeforeRefresh(store, (visitId) =>
        createCoordinator(store).sync(visitId, getOfflineDeviceId()),
      )
      const workingSet = await edgeApi.offline.workingSet(getOfflineDeviceId())
      const outcomeResponse = await edgeApi.syncConflicts.workshopOutcomes()
      const nextVisits: VisitaOffline[] = []
      const nextOperations: OperacionesPorVisita = {}
      for (const entry of workingSet.visits) {
        const id = entry.visit.id
        if (!id) continue
        const previous = await store.getVisit(id)
        const catalogs = entry.certificate_catalogs ?? workingSet.certificate_catalogs
        const catalogState = refreshedVisitCatalogs({
          previous,
          refreshedContext: { ...entry, certificate_catalogs: catalogs },
          refreshedCatalogs: catalogs,
        })
        const visit: VisitaOffline = {
          id,
          ...catalogState,
          cachedAt: new Date().toISOString(),
          estadoLocal: previous?.estadoLocal ?? "disponible",
          synchronizationPending: previous?.synchronizationPending ?? false,
          backendStatus: entry.visit.estado ?? previous?.backendStatus,
          visitAcknowledgement: previous?.visitAcknowledgement,
          claimedByDeviceId: previous?.claimedByDeviceId,
          claimedAt: previous?.claimedAt,
        }
        await store.saveVisit(visit)
        // Reconnect refresh also replays queued work. Stable operation ids make
        // replay safe when a previous request reached the server but lost its reply.
        nextOperations[id] = await createCoordinator(store).sync(id, getOfflineDeviceId())
        nextVisits.push((await store.getVisit(id)) ?? visit)
      }
      setVisits(nextVisits)
      setOperationsByVisit(nextOperations)
      setConflictOutcomes(outcomeResponse.items)
      setConnection("online")
    } catch (caught) {
      setConnection("error")
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la agenda offline")
    }
  }, [])

  const syncVisit = useCallback(async (visitId: string) => {
    if (typeof window === "undefined" || !navigator.onLine) {
      setConnection("offline")
      return
    }

    setSyncingVisits((current) => (current.includes(visitId) ? current : [...current, visitId]))
    setSyncErrors((current) => {
      const next = { ...current }
      delete next[visitId]
      return next
    })

    try {
      const store = new IndexedDbOfflineStore()
      const operations = await createCoordinator(store).sync(visitId, getOfflineDeviceId())
      setOperationsByVisit((current) => ({ ...current, [visitId]: operations }))
      setConnection(navigator.onLine ? "online" : "offline")
    } catch (caught) {
      setSyncErrors((current) => ({
        ...current,
        [visitId]: caught instanceof Error ? caught.message : "No se pudo sincronizar la visita",
      }))
      setConnection(navigator.onLine ? "error" : "offline")
    } finally {
      setSyncingVisits((current) => current.filter((id) => id !== visitId))
    }
  }, [])

  useEffect(() => {
    const online = () => {
      setConnection("online")
      void refresh()
    }
    const offline = () => setConnection("offline")
    window.addEventListener("online", online)
    window.addEventListener("offline", offline)
    if (navigator.onLine) window.setTimeout(() => void refresh(), 0)
    return () => {
      window.removeEventListener("online", online)
      window.removeEventListener("offline", offline)
    }
  }, [refresh])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Trabajo offline</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            La agenda cacheada se actualiza al recuperar conectividad. El trabajo pendiente no se
            elimina.
          </p>
        </div>
        <Badge
          variant={
            connection === "online"
              ? "default"
              : connection === "error"
                ? "destructive"
                : "secondary"
          }
        >
          {connection === "actualizando"
            ? "Actualizando…"
            : connection === "online"
              ? "Online"
              : connection === "offline"
                ? "Offline"
                : "Error"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
          <span>{visits.length} visita(s) disponible(s) en la ventana de trabajo</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
            disabled={connection === "actualizando"}
          >
            Actualizar ahora
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {conflictOutcomes.length > 0 ? (
          <section className="space-y-2 rounded-md border p-3" aria-label="Resoluciones de conflictos">
            <h3 className="text-sm font-medium">Resoluciones administrativas</h3>
            <ul className="space-y-2 text-sm">
              {conflictOutcomes.map((outcome) => (
                <li className="rounded border p-2" key={outcome.conflict_id}>
                  <p>
                    {outcome.resolution_action === "accepted"
                      ? "Operación aceptada y aplicada"
                      : outcome.resolution_action === "rejected"
                        ? "Operación rechazada"
                        : "Corrección autorizada"}
                  </p>
                  <p className="text-muted-foreground">Visita {outcome.visit_id} · operación {outcome.operation_id}</p>
                  <p className="text-muted-foreground">Motivo: {outcome.resolution_reason}</p>
                  <time className="text-xs text-muted-foreground" dateTime={outcome.resolved_at}>
                    {new Date(outcome.resolved_at).toLocaleString()}
                  </time>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <ul className="space-y-2 text-sm">
          {visits.map((visit) => {
            const operations = operationsByVisit[visit.id] ?? []
            const queuedOperations = operations.filter(
              (operation) =>
                operation.estado === "guardada_local" || operation.estado === "fallida",
            )
            const acknowledgedOperations = operations.filter(
              (operation) => operation.estado === "sincronizada",
            )
            const conflictOperations = operations.filter(
              (operation) => operation.estado === "conflicto",
            )
            const failedOperations = operations.filter(
              (operation) => operation.estado === "fallida",
            )
            const syncing = syncingVisits.includes(visit.id)

            return (
              <li className="space-y-3 rounded-md border px-3 py-3" key={visit.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs">{visit.id}</p>
                    <p className="mt-1 text-muted-foreground">
                      {visit.estadoLocal === "completada_local"
                        ? "Completada localmente; el estado backend es independiente"
                        : visit.synchronizationPending
                          ? "Trabajo local pendiente de sincronización backend"
                          : "Disponible para trabajo local"}
                    </p>
                  </div>
                  {queuedOperations.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void syncVisit(visit.id)}
                      disabled={connection === "offline" || syncing}
                    >
                      {syncing
                        ? "Sincronizando…"
                        : failedOperations.length > 0
                          ? "Reintentar"
                          : "Sincronizar"}
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-1 text-sm">
                  {syncing ? <p>Sincronizando operaciones…</p> : null}
                  {!syncing && conflictOperations.length > 0 ? (
                    <p className="text-destructive">
                      Conflicto de sincronización ({conflictOperations.length})
                    </p>
                  ) : null}
                  {!syncing && failedOperations.length > 0 ? (
                    <p className="text-destructive">Fallida ({failedOperations.length})</p>
                  ) : null}
                  {!syncing && queuedOperations.length > 0 ? (
                    <p className="text-muted-foreground">
                      {queuedOperations.length} operación(es) pendiente(s) de reconocimiento backend
                    </p>
                  ) : null}
                  {!syncing && queuedOperations.length === 0 && conflictOperations.length === 0 ? (
                    <p className="text-muted-foreground">
                      No hay operaciones en cola
                      {acknowledgedOperations.length > 0
                        ? `; ${acknowledgedOperations.length} reconocimiento(s) recibido(s)`
                        : "."}
                    </p>
                  ) : null}
                  {syncErrors[visit.id] ? (
                    <p className="text-destructive">{syncErrors[visit.id]}</p>
                  ) : null}
                </div>

                {operations.length > 0 ? (
                  <ul className="space-y-1 border-t pt-2 text-xs">
                    {operations.map((operation) => (
                      <li className="space-y-1" key={operation.operationId}>
                        <div className="flex justify-between gap-3">
                          <span className="font-mono">{operation.operationId}</span>
                          <span>
                            {operation.estado === "sincronizada"
                              ? `Reconocida: ${operation.receipt?.serverStatus ?? "sincronizada"}`
                              : operation.estado === "conflicto"
                                ? "Conflicto; datos locales conservados"
                                : operation.estado === "fallida"
                                  ? "Fallida"
                                  : operation.estado === "sincronizando"
                                    ? "Sincronizando"
                                    : "Pendiente"}
                          </span>
                        </div>
                        {operation.receipt ? (
                          <p className="text-muted-foreground">
                            Recibo recibido {operation.receipt.acknowledgedAt}
                          </p>
                        ) : null}
                        {operation.lastError ? (
                          <p className="text-destructive">{operation.lastError}</p>
                        ) : null}
                        {operation.estado === "conflicto" ? (
                          <p className="text-muted-foreground">
                            El contenido local se conserva en este dispositivo y requiere resolución administrativa.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="border-t pt-2 text-xs text-muted-foreground">
                    No hay operaciones locales en cola para esta visita.
                  </p>
                )}
              </li>
            )
          })}
          {visits.length === 0 ? (
            <li className="py-4 text-center text-muted-foreground">No hay visitas cacheadas.</li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  )
}
