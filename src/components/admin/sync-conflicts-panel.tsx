"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { edgeApi } from "@/lib/api"

type Conflict = Record<string, unknown> & {
  id: string
  operation_id: string
  visita_id: string
  operation_kind?: string
  payload?: Record<string, unknown>
  reason?: string
  resolved_at?: string | null
  resolution_action?: string | null
  resolution_reason?: string | null
}

type CorrectionInput = { provider_id: string; starts_at: string; ends_at: string }

export function SyncConflictsPanel() {
  const [items, setItems] = useState<Conflict[]>([])
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [corrections, setCorrections] = useState<Record<string, CorrectionInput>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [message, setMessage] = useState<string>()

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const result = await edgeApi.syncConflicts.list()
      setItems(result.items.filter((item): item is Conflict =>
        typeof item.id === "string" && typeof item.operation_id === "string" && typeof item.visita_id === "string",
      ))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los conflictos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const resolve = async (conflict: Conflict, action: "accept" | "reject" | "correction") => {
    const reason = reasons[conflict.id]?.trim() ?? ""
    if (!reason) {
      setError("Es obligatorio indicar el motivo de la resolución.")
      return
    }
    setBusy(conflict.id)
    setError(undefined)
    setMessage(undefined)
    try {
      const correction = corrections[conflict.id]
      await edgeApi.syncConflicts.resolve(conflict.id, {
        action,
        reason,
        ...(action === "correction" ? {
          source_certificate_id: typeof conflict.payload?.certificate_id === "string"
            ? conflict.payload.certificate_id
            : undefined,
          provider_id: correction?.provider_id,
          starts_at: correction?.starts_at ? new Date(correction.starts_at).toISOString() : undefined,
          ends_at: correction?.ends_at ? new Date(correction.ends_at).toISOString() : undefined,
        } : {}),
      })
      setMessage(action === "accept" ? "Operación aceptada y aplicada." : action === "reject" ? "Operación rechazada." : "Corrección autorizada y programada.")
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo resolver el conflicto")
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Conflictos de sincronización</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">Inspeccioná el contenido original y registrá una decisión explícita.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>Actualizar</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {message ? <p className="text-sm" role="status">{message}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">Cargando conflictos…</p> : null}
        {!loading && items.length === 0 ? <p className="text-sm text-muted-foreground">No hay conflictos de sincronización.</p> : null}
        {items.map((conflict) => {
          const resolved = Boolean(conflict.resolved_at)
          const correction = corrections[conflict.id] ?? { provider_id: "", starts_at: "", ends_at: "" }
          return (
            <article className="space-y-3 rounded-md border p-3" key={conflict.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{resolved ? `Resuelto: ${conflict.resolution_action}` : "Pendiente de resolución"}</p>
                  <p className="text-xs text-muted-foreground">Visita {conflict.visita_id} · operación {conflict.operation_id} · {String(conflict.operation_kind ?? "operación")}</p>
                </div>
                <p className="text-xs text-muted-foreground">{String(conflict.reason ?? "")}</p>
              </div>
              <details>
                <summary className="cursor-pointer text-sm">Ver payload original</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(conflict.payload ?? {}, null, 2)}</pre>
              </details>
              {resolved ? (
                <p className="text-sm text-muted-foreground">Motivo administrativo: {conflict.resolution_reason}</p>
              ) : (
                <div className="space-y-3">
                  <Textarea
                    value={reasons[conflict.id] ?? ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [conflict.id]: event.target.value }))}
                    placeholder="Motivo obligatorio de la decisión"
                    aria-label="Motivo obligatorio"
                    maxLength={1000}
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input value={correction.provider_id} onChange={(event) => setCorrections((current) => ({ ...current, [conflict.id]: { ...correction, provider_id: event.target.value } }))} placeholder="ID del Taller Móvil" aria-label="ID del Taller Móvil para corrección" />
                    <Input type="datetime-local" value={correction.starts_at} onChange={(event) => setCorrections((current) => ({ ...current, [conflict.id]: { ...correction, starts_at: event.target.value } }))} aria-label="Inicio de la visita de corrección" />
                    <Input type="datetime-local" value={correction.ends_at} onChange={(event) => setCorrections((current) => ({ ...current, [conflict.id]: { ...correction, ends_at: event.target.value } }))} aria-label="Fin de la visita de corrección" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void resolve(conflict, "accept")} disabled={busy === conflict.id || !reasons[conflict.id]?.trim()}>Aceptar y aplicar</Button>
                    <Button type="button" variant="outline" onClick={() => void resolve(conflict, "reject")} disabled={busy === conflict.id || !reasons[conflict.id]?.trim()}>Rechazar</Button>
                    <Button type="button" variant="outline" onClick={() => void resolve(conflict, "correction")} disabled={busy === conflict.id || !reasons[conflict.id]?.trim() || !correction.provider_id || !correction.starts_at || !correction.ends_at}>Autorizar corrección</Button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </CardContent>
    </Card>
  )
}
