"use client"

import { useState } from "react"
import { AlertTriangle, CheckCircle2, Download, ShieldAlert } from "lucide-react"

import { PageHeader } from "@/components/common/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { edgeApi } from "@/lib/api"

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires",
}).format(new Date())

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "No se pudo generar el backup."
}

export function ManualBackupPanel() {
  const [scope, setScope] = useState<"complete" | "date_range">("complete")
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [confirmed, setConfirmed] = useState(false)
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "success"; filename: string; checksum: string | null; warnings: string[] }
    | { kind: "error"; message: string }
  >({ kind: "idle" })
  const [pending, setPending] = useState(false)

  const validRange = scope === "complete" || (Boolean(from) && Boolean(to) && from <= to)

  async function generate() {
    if (!confirmed || !validRange || pending) return
    setPending(true)
    setState({ kind: "idle" })
    try {
      const result = await edgeApi.backups.download(
        scope === "complete" ? { scope } : { scope, from, to },
      )
      const url = URL.createObjectURL(result.blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = result.filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      setState({
        kind: "success",
        filename: result.filename,
        checksum: result.archiveSha256,
        warnings: result.warnings,
      })
    } catch (error) {
      setState({ kind: "error", message: errorMessage(error) })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Backup manual"
        descripcion="Descarga inmediata de registros y archivos de aplicación. El archivo no se conserva en System Solutions."
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-amber-600" />
            Exportación sensible sin cifrar
          </CardTitle>
          <CardDescription>
            El ZIP puede contener datos personales, certificados, firmas y fotografías. Descárgalo
            sólo en un dispositivo protegido.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant={scope === "complete" ? "default" : "outline"}
              onClick={() => setScope("complete")}
            >
              Backup completo
            </Button>
            <Button
              type="button"
              variant={scope === "date_range" ? "default" : "outline"}
              onClick={() => setScope("date_range")}
            >
              Backup por rango de fechas
            </Button>
          </div>

          {scope === "date_range" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="backup-from">Desde (Argentina, inclusivo)</Label>
                <Input id="backup-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="backup-to">Hasta (Argentina, inclusivo)</Label>
                <Input id="backup-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
              </div>
              {!validRange ? <p className="text-sm text-destructive sm:col-span-2">El rango debe ser válido y Desde no puede ser posterior a Hasta.</p> : null}
            </div>
          ) : null}

          <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} />
            <span>
              Confirmo que entiendo que esta descarga es inmediata, contiene información sensible y
              se entrega sin cifrar.
            </span>
          </label>

          <Button disabled={!confirmed || !validRange || pending} onClick={() => void generate()}>
            <Download className="mr-2 size-4" />
            {pending ? "Generando y preparando descarga…" : "Generar y descargar ZIP"}
          </Button>

          {pending ? <p className="text-sm text-muted-foreground" role="status">Procesando en una instantánea consistente. La descarga no se conserva en el servidor.</p> : null}
          {state.kind === "success" ? (
            <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm" role="status">
              <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4 text-emerald-600" />Descarga iniciada: {state.filename}</p>
              {state.checksum ? <p className="break-all text-xs text-muted-foreground">SHA-256: {state.checksum}</p> : null}
              {state.warnings.length ? (
                <div className="space-y-1 text-amber-700">
                  <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" />El backup se descargó con advertencias.</p>
                  {state.warnings.map((warning) => <p key={warning}>· {warning}</p>)}
                </div>
              ) : <Badge variant="secondary">Integridad registrada</Badge>}
            </div>
          ) : null}
          {state.kind === "error" ? <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{state.message} Puedes corregir el rango o reintentar; cada intento genera un nuevo registro.</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
