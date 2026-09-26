"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { edgeApi } from "@/lib/api"
import { IndexedDbOfflineStore, type VisitaOffline } from "@/lib/offline/sync"

type EstadoConexion = "online" | "offline" | "actualizando" | "error"

export function SincronizacionPanel() {
  const [connection, setConnection] = useState<EstadoConexion>(() =>
    typeof navigator !== "undefined" && navigator.onLine ? "online" : "offline",
  )
  const [visits, setVisits] = useState<VisitaOffline[]>([])
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    if (typeof window === "undefined" || !navigator.onLine) {
      setConnection("offline")
      return
    }
    if (process.env.NEXT_PUBLIC_DATA_SOURCE !== "supabase") {
      setVisits([])
      setConnection("online")
      return
    }
    setConnection("actualizando")
    setError(undefined)
    try {
      const store = new IndexedDbOfflineStore()
      const workingSet = await edgeApi.offline.workingSet()
      const nextVisits: VisitaOffline[] = []
      for (const entry of workingSet.visits) {
        const id = entry.visit.id
        if (!id) continue
        const previous = await store.getVisit(id)
        const visit: VisitaOffline = {
          id,
          context: entry.context,
          cachedAt: new Date().toISOString(),
          estadoLocal: previous?.estadoLocal ?? "disponible",
          synchronizationPending: previous?.synchronizationPending ?? false,
        }
        await store.saveVisit(visit)
        nextVisits.push(visit)
      }
      setVisits(nextVisits)
      setConnection("online")
    } catch (caught) {
      setConnection("error")
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la agenda offline")
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
        <ul className="space-y-2 text-sm">
          {visits.map((visit) => (
            <li
              className="flex items-center justify-between rounded-md border px-3 py-2"
              key={visit.id}
            >
              <span className="font-mono text-xs">{visit.id}</span>
              <span className="text-muted-foreground">
                {visit.estadoLocal === "completada_local"
                  ? "Completada localmente"
                  : visit.synchronizationPending
                    ? "Sincronización pendiente"
                    : "Disponible"}
              </span>
            </li>
          ))}
          {visits.length === 0 ? (
            <li className="py-4 text-center text-muted-foreground">No hay visitas cacheadas.</li>
          ) : null}
        </ul>
      </CardContent>
    </Card>
  )
}
