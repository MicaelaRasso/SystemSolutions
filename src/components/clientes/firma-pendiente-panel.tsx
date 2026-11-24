"use client"

import { useState } from "react"
import { FileSignature, Upload } from "lucide-react"

import { SignaturePad, dataUrlToFile } from "@/components/certificados/signature-pad"
import { MarcaObligatoria } from "@/components/common/etiqueta-obligatoria"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEdgePendingClientSignatureVisits, useUploadEdgeVisitSignature } from "@/lib/api/hooks"
import { Cargando } from "@/components/common/cargando"
import { fmtFechaHoraArgentina } from "@/lib/format"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

/**
 * Aviso después de firmar. En una visita en «Requiere finalización» (E4) los certificados se
 * emiten cuando la visita se cierra (por el Técnico o por el Administrador).
 */
export function mensajeFirmaRecibida(estadoVisita: unknown, finalizados: number) {
  if (finalizados > 0)
    return `Firma recibida. Se emitieron ${finalizados} certificado(s) de la visita.`
  if (estadoVisita === "requiere_finalizacion")
    return "Firma recibida. La visita todavía se está cerrando: los certificados se emitirán cuando se complete."
  return "Firma recibida. Los certificados elegibles se finalizarán en el backend."
}

/** Si el Cliente eligió una foto se sube la foto; si no, la firma dibujada en el panel. */
export function archivoDeFirma(foto: File | undefined, dibujo: string | undefined) {
  if (foto) return foto
  return dibujo ? dataUrlToFile(dibujo, "firma-cliente.png") : undefined
}

export function FirmaPendientePanel() {
  const visits = useEdgePendingClientSignatureVisits()
  const upload = useUploadEdgeVisitSignature()
  const [names, setNames] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [drawings, setDrawings] = useState<Record<string, string | undefined>>({})
  // Se incrementa al subir la firma para vaciar el panel de dibujo (se vuelve a montar).
  const [padKey, setPadKey] = useState(0)
  const [message, setMessage] = useState<string>()

  if (visits.isError)
    return <ErrorState error={visits.error} onRetry={() => void visits.refetch()} />
  if (visits.isPending)
    return (
      <Card>
        <CardContent>
          <Cargando texto="Cargando visitas completadas…" />
        </CardContent>
      </Card>
    )

  const pending = visits.data.visits
  return (
    <Card>
      <CardHeader>
        <CardTitle>Visitas que esperan firma del Cliente</CardTitle>
        <CardDescription>
          Una firma digitalizada se reutiliza en todos los certificados elegibles de la Visita de
          servicio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? (
          <p className="rounded-md bg-muted p-3 text-sm" role="status">
            {message}
          </p>
        ) : null}
        {pending.length === 0 ? (
          <EmptyState
            icono={FileSignature}
            titulo="No hay certificados pendientes de tu firma"
            descripcion="Las visitas completadas aparecen aquí cuando tienen trabajo evaluado sin Firma digitalizada del Cliente."
            className="py-8"
          />
        ) : null}
        <div className="space-y-4">
          {pending.map((visit) => {
            const visitRecord = visit.visit as Record<string, unknown>
            const name = visit.yacimiento.nombre || `Visita ${visit.visit.id}`
            const date = text(visitRecord.starts_at) ?? text(visitRecord.fecha_ejecucion)
            const file = files[visit.visit.id]
            const drawing = drawings[visit.visit.id]
            const signatureFile = archivoDeFirma(file, drawing)
            const signerName = names[visit.visit.id] ?? ""
            const hasFullName = signerName.trim().split(/\s+/).filter(Boolean).length >= 2
            return (
              <div className="rounded-lg border p-3 sm:p-4" key={visit.visit.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-sm text-muted-foreground">
                      {fmtFechaHoraArgentina(date) ?? "Fecha no informada"} ·{" "}
                      {visit.work_orders.length} Orden(es) de trabajo
                    </p>
                  </div>
                  <Badge variant="secondary">Certificado pendiente</Badge>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="space-y-1 md:max-w-md">
                    <Label htmlFor={`signer-${visit.visit.id}`}>
                      Nombre y apellido de quien firma
                      <MarcaObligatoria />
                    </Label>
                    <Input
                      id={`signer-${visit.visit.id}`}
                      aria-required
                      value={signerName}
                      onChange={(event) =>
                        setNames((current) => ({
                          ...current,
                          [visit.visit.id]: event.target.value,
                        }))
                      }
                      placeholder="Nombre y apellido"
                    />
                  </div>
                  <SignaturePad
                    key={`${visit.visit.id}-${padKey}`}
                    title="Dibujá tu firma"
                    onChange={(dataUrl) =>
                      setDrawings((current) => ({ ...current, [visit.visit.id]: dataUrl }))
                    }
                  />
                  <div className="space-y-1 md:max-w-md">
                    <Label htmlFor={`file-${visit.visit.id}`}>
                      ¿Preferís subir una foto de la firma? (opcional)
                    </Label>
                    <Input
                      id={`file-${visit.visit.id}`}
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        setFiles((current) => ({
                          ...current,
                          [visit.visit.id]: event.target.files?.[0],
                        }))
                      }
                      className="h-auto pointer-coarse:h-auto"
                    />
                  </div>
                  {file ? (
                    <p className="text-xs text-muted-foreground">
                      Se va a usar la foto elegida en lugar del dibujo.
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    La firma se asocia a la visita del Cliente titular del yacimiento. El nombre no
                    acredita ni reemplaza la autoridad de quien firma.
                  </p>
                  <Button
                    className="max-sm:w-full"
                    disabled={!hasFullName || !signatureFile || upload.isPending}
                    onClick={() => {
                      if (!signatureFile) return
                      upload.mutate(
                        {
                          visitId: visit.visit.id,
                          input: {
                            party: "cliente",
                            captureMethod: "panel_cliente",
                            signerName,
                            file: signatureFile,
                          },
                        },
                        {
                          onSuccess: async (resultado) => {
                            setMessage(
                              mensajeFirmaRecibida(
                                visit.visit.estado,
                                resultado.finalized_certificates.length,
                              ),
                            )
                            setFiles((current) => ({ ...current, [visit.visit.id]: undefined }))
                            setDrawings((current) => ({
                              ...current,
                              [visit.visit.id]: undefined,
                            }))
                            setPadKey((current) => current + 1)
                            await visits.refetch()
                          },
                          onError: (error) =>
                            setMessage(
                              error instanceof Error ? error.message : "No se pudo subir la firma",
                            ),
                        },
                      )
                    }}
                  >
                    <Upload className="mr-2 size-4" />
                    {upload.isPending ? "Subiendo…" : "Subir firma"}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  La plataforma registra la cuenta autenticada, el nombre mostrado, el método de
                  captura y el momento de recepción. No valida autoridad legal ni reemplaza firmas
                  anteriores.
                </p>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
