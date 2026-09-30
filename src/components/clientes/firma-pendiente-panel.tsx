"use client"

import { useState } from "react"
import { FileSignature, Upload } from "lucide-react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useEdgePendingClientSignatureVisits, useUploadEdgeVisitSignature } from "@/lib/api/hooks"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

export function FirmaPendientePanel() {
  const visits = useEdgePendingClientSignatureVisits()
  const upload = useUploadEdgeVisitSignature()
  const [names, setNames] = useState<Record<string, string>>({})
  const [files, setFiles] = useState<Record<string, File | undefined>>({})
  const [message, setMessage] = useState<string>()

  if (visits.isError)
    return <ErrorState error={visits.error} onRetry={() => void visits.refetch()} />
  if (visits.isPending)
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Cargando visitas completadas…
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
            const signerName = names[visit.visit.id] ?? ""
            return (
              <div className="rounded-lg border p-4" key={visit.visit.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{name}</p>
                    <p className="text-sm text-muted-foreground">
                      {date ? new Date(date).toLocaleString("es-AR") : "Fecha no informada"} ·{" "}
                      {visit.work_orders.length} Orden(es) de trabajo
                    </p>
                  </div>
                  <Badge variant="secondary">Certificado pendiente</Badge>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <div className="space-y-1">
                    <Label htmlFor={`signer-${visit.visit.id}`}>
                      Nombre que se mostrará junto a la firma
                    </Label>
                    <Input
                      id={`signer-${visit.visit.id}`}
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
                  <div className="space-y-1">
                    <Label htmlFor={`file-${visit.visit.id}`}>Foto de firma</Label>
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
                      className="h-auto"
                    />
                  </div>
                  <Button
                    disabled={!signerName.trim() || !file || upload.isPending}
                    onClick={() => {
                      if (!file) return
                      upload.mutate(
                        {
                          visitId: visit.visit.id,
                          input: {
                            party: "cliente",
                            captureMethod: "panel_cliente",
                            signerName,
                            file,
                          },
                        },
                        {
                          onSuccess: async () => {
                            setMessage(
                              "Firma recibida. Los certificados elegibles se finalizarán en el backend.",
                            )
                            setFiles((current) => ({ ...current, [visit.visit.id]: undefined }))
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
