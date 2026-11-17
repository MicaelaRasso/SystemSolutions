"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { edgeApi } from "@/lib/api"
import { traducirMensajeError } from "@/lib/domain/errores"
import { esFirmaYaRegistrada, esVisitaVencida } from "@/lib/offline/sync"
import { Cargando } from "@/components/common/cargando"

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

/** La visita de corrección lleva taller, inicio y fin estimado. */
type CorrectionInput = { provider_id: string; starts_at: string; ends_at: string }

const ETIQUETAS_OPERACION: Readonly<Record<string, string>> = {
  start_visit: "Inicio de la visita",
  work_order_outcome: "Resultado de una orden de trabajo",
  start_certificate_draft: "Inicio del borrador de certificado",
  update_certificate_draft: "Edición del borrador de certificado",
  capture_evidence: "Foto del certificado",
  upload_evidence: "Foto del certificado",
  upload_photo: "Foto del certificado",
  finalize_certificate: "Cierre del certificado",
  submit_signature: "Firma de la visita",
  complete_visit: "Completar visita",
  add_work_order: "Agregar válvula del catálogo",
  create_valve: "Alta de válvula nueva",
  set_part_diario: "Número de Parte Diario",
  attach_part_diario_image: "Foto del Parte Diario",
}

/** Nombre en español del tipo de operación offline; los desconocidos se muestran tal cual. */
export function etiquetaOperacion(operationKind: string | undefined): string {
  if (!operationKind) return "Operación"
  return ETIQUETAS_OPERACION[operationKind] ?? operationKind
}

/** La operación llegó después del cierre automático de la visita (E3). */
export function esConflictoPorVencimiento(conflict: Pick<Conflict, "reason">): boolean {
  return esVisitaVencida(conflict.reason)
}

/** El servidor no permite aceptar (reaplicar) una firma: se rechaza o se autoriza una corrección. */
export function sePuedeAceptar(operationKind: string | undefined): boolean {
  return operationKind !== "submit_signature"
}

/** Cuerpo de la corrección: taller, inicio y fin estimado de la visita. */
export function datosDeCorreccion(
  conflict: Pick<Conflict, "payload">,
  correction: CorrectionInput | undefined,
) {
  return {
    source_certificate_id:
      typeof conflict.payload?.certificate_id === "string"
        ? conflict.payload.certificate_id
        : undefined,
    provider_id: correction?.provider_id || undefined,
    starts_at: correction?.starts_at ? new Date(correction.starts_at).toISOString() : undefined,
    ends_at: correction?.ends_at ? new Date(correction.ends_at).toISOString() : undefined,
  }
}

/** Mensaje del inicio rechazado porque el taller ya tenía otra visita en curso. */
export const MOTIVO_TALLER_CON_VISITA_EN_CURSO =
  "The Taller Móvil already has a visit in progress; complete it before starting another"

/** Ayuda para decidir los conflictos de firma (que no se pueden aceptar) y los de visitas vencidas. */
export function avisoDelConflicto(
  conflict: Pick<Conflict, "operation_kind" | "reason">,
): string | undefined {
  if (esConflictoPorVencimiento(conflict)) {
    return conflict.operation_kind === "submit_signature"
      ? "La visita venció antes de recibir esta firma. Resolvelo con «Rechazar»: el Técnico puede volver a firmar desde el panel del taller y el Cliente desde el portal."
      : "La operación llegó después de que la visita venció. Si el trabajo se hizo ese día, usá «Aceptar y aplicar» empezando por la más antigua de la visita; si no, rechazala."
  }
  if (conflict.reason?.includes(MOTIVO_TALLER_CON_VISITA_EN_CURSO))
    return "El taller tenía otra visita en curso cuando llegó este inicio (un taller atiende una visita a la vez). Si esa visita ya se completó o quedó en «Requiere finalización», usá «Aceptar y aplicar»; si no, rechazalo."
  if (conflict.operation_kind !== "submit_signature") return undefined
  if (esFirmaYaRegistrada(conflict.reason))
    return "La firma de esta parte ya estaba registrada y se conserva. Este reintento no cambia nada: resolvelo con «Rechazar»."
  return "Una firma no se puede aceptar desde acá: resolvelo con «Rechazar» o autorizá una corrección."
}

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
      setItems(
        result.items.filter(
          (item): item is Conflict =>
            typeof item.id === "string" &&
            typeof item.operation_id === "string" &&
            typeof item.visita_id === "string",
        ),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los conflictos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void edgeApi.syncConflicts
      .list()
      .then((result) =>
        setItems(
          result.items.filter(
            (item): item is Conflict =>
              typeof item.id === "string" &&
              typeof item.operation_id === "string" &&
              typeof item.visita_id === "string",
          ),
        ),
      )
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "No se pudieron cargar los conflictos"),
      )
      .finally(() => setLoading(false))
  }, [])

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
      await edgeApi.syncConflicts.resolve(conflict.id, {
        action,
        reason,
        ...(action === "correction" ? datosDeCorreccion(conflict, corrections[conflict.id]) : {}),
      })
      setMessage(
        action === "accept"
          ? "Operación aceptada y aplicada."
          : action === "reject"
            ? "Operación rechazada."
            : "Corrección autorizada y programada.",
      )
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo resolver el conflicto")
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Conflictos de sincronización</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspeccioná el contenido original y registrá una decisión explícita.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void refresh()} disabled={loading}>
          Actualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm" role="status">
            {message}
          </p>
        ) : null}
        {loading ? <Cargando variante="linea" texto="Cargando conflictos…" /> : null}
        {!loading && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay conflictos de sincronización.</p>
        ) : null}
        {items.map((conflict) => {
          const resolved = Boolean(conflict.resolved_at)
          const correction = corrections[conflict.id] ?? {
            provider_id: "",
            starts_at: "",
            ends_at: "",
          }
          const vencida = esConflictoPorVencimiento(conflict)
          return (
            <article className="space-y-3 rounded-md border p-3" key={conflict.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {resolved
                      ? `Resuelto: ${
                          conflict.resolution_action === "accepted"
                            ? "aceptado y aplicado"
                            : conflict.resolution_action === "rejected"
                              ? "rechazado"
                              : conflict.resolution_action === "correction_authorized"
                                ? "corrección autorizada"
                                : String(conflict.resolution_action ?? "")
                        }`
                      : "Pendiente de resolución"}
                  </p>
                  <p className="text-sm">{etiquetaOperacion(conflict.operation_kind)}</p>
                  <p className="text-xs break-all text-muted-foreground">
                    Visita {conflict.visita_id} · operación {conflict.operation_id}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  {vencida ? <Badge variant="outline">Visita cerrada por vencimiento</Badge> : null}
                  <p className="text-xs text-muted-foreground">
                    {traducirMensajeError(String(conflict.reason ?? ""))}
                  </p>
                </div>
              </div>
              <details>
                <summary className="cursor-pointer text-sm pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                  Ver payload original
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(conflict.payload ?? {}, null, 2)}
                </pre>
              </details>
              {!resolved && avisoDelConflicto(conflict) ? (
                <p className="text-sm text-muted-foreground">{avisoDelConflicto(conflict)}</p>
              ) : null}
              {resolved ? (
                <p className="text-sm text-muted-foreground">
                  Motivo administrativo: {conflict.resolution_reason}
                </p>
              ) : (
                <div className="space-y-3">
                  <Textarea
                    value={reasons[conflict.id] ?? ""}
                    onChange={(event) =>
                      setReasons((current) => ({ ...current, [conflict.id]: event.target.value }))
                    }
                    placeholder="Motivo obligatorio de la decisión"
                    aria-label="Motivo obligatorio"
                    maxLength={1000}
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input
                      value={correction.provider_id}
                      onChange={(event) =>
                        setCorrections((current) => ({
                          ...current,
                          [conflict.id]: { ...correction, provider_id: event.target.value },
                        }))
                      }
                      placeholder="ID del Taller Móvil"
                      aria-label="ID del Taller Móvil para corrección"
                    />
                    <Input
                      type="datetime-local"
                      value={correction.starts_at}
                      onChange={(event) =>
                        setCorrections((current) => ({
                          ...current,
                          [conflict.id]: { ...correction, starts_at: event.target.value },
                        }))
                      }
                      aria-label="Inicio de la visita de corrección"
                    />
                    <Input
                      type="datetime-local"
                      value={correction.ends_at}
                      onChange={(event) =>
                        setCorrections((current) => ({
                          ...current,
                          [conflict.id]: { ...correction, ends_at: event.target.value },
                        }))
                      }
                      aria-label="Fin estimado de la visita de corrección"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sePuedeAceptar(conflict.operation_kind) ? (
                      <Button
                        type="button"
                        onClick={() => void resolve(conflict, "accept")}
                        disabled={busy === conflict.id || !reasons[conflict.id]?.trim()}
                      >
                        Aceptar y aplicar
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void resolve(conflict, "reject")}
                      disabled={busy === conflict.id || !reasons[conflict.id]?.trim()}
                    >
                      Rechazar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void resolve(conflict, "correction")}
                      disabled={
                        busy === conflict.id ||
                        !reasons[conflict.id]?.trim() ||
                        !correction.provider_id ||
                        !correction.starts_at ||
                        !correction.ends_at
                      }
                    >
                      Autorizar corrección
                    </Button>
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
