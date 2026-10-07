"use client"
import Link from "next/link"
import { useParams } from "next/navigation"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { CertificateExpandedDetails } from "@/components/certificados/certificate-expanded-details"
import { useEdgeAdminCertificate } from "@/lib/api/hooks"
import { edgeApi } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { useState } from "react"
export default function Page() {
  const params = useParams<{ id: string }>()
  const query = useEdgeAdminCertificate(params.id)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  if (query.isLoading) return <div className="h-48 animate-pulse rounded-xl bg-muted" />
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!query.data) return <EmptyState titulo="Certificado no encontrado" />
  const download = async () => {
    setDownloadError(null)
    try {
      const response = await edgeApi.observability.certificates.download(params.id)
      if (!response.ok) throw new Error("No se pudo descargar el Certificado")
      const href = URL.createObjectURL(await response.blob())
      const anchor = document.createElement("a")
      anchor.href = href
      anchor.download = `certificado-${String(query.data.certificate.numero ?? params.id)}.json`
      anchor.click()
      URL.revokeObjectURL(href)
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "No se pudo descargar el Certificado")
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Detalle del Certificado"
        acciones={
          <div className="flex items-center gap-4">
            <Button onClick={() => void download()}>Descargar Certificado</Button>
            <Link className="text-primary underline" href="/admin/certificados">Volver al historial</Link>
          </div>
        }
      />
      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
      <CertificateExpandedDetails certificate={query.data.certificate} />
      <section>
        <h2 className="mb-2 font-semibold">Historial de la Válvula</h2>
        <p className="mb-3 text-sm text-muted-foreground">{query.data.history.length} certificados, incluidos pendientes y finalizados, del mismo historial.</p>
        {query.data.history.length === 0 ? <p className="text-sm text-muted-foreground">No hay certificados históricos.</p> : (
          <ol className="space-y-2">
            {query.data.history.map((certificate, index) => (
              <li key={certificate.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3 text-sm">
                <span>#{index + 1} · {String(certificate.fecha_ejecucion ?? certificate.created_at ?? "Fecha sin registrar")} · {String(certificate.estado ?? "—")} · N.º {String(certificate.numero ?? "pendiente")}</span>
                {certificate.id === params.id ? <span aria-current="page" className="font-medium">Certificado actual</span> : <Link className="text-primary underline" href={`/admin/certificados/${certificate.id}`}>Abrir Certificado</Link>}
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Eventos de auditoría relacionados</h2>
        {query.data.audit_events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay eventos relacionados.</p>
        ) : (
          <ul className="space-y-2">
            {query.data.audit_events.map((event) => (
              <li key={event.id} className="rounded border p-3 text-sm">
                <p>{event.accion} · {event.resultado} · <time dateTime={event.recibida_en}>{new Date(event.recibida_en).toLocaleString("es-AR")}</time></p>
                <p className="mt-1 text-muted-foreground">Actor: {event.actor_email || event.actor_cuenta_id || "Sistema"} · Correlación: {event.identidad_correlacion ?? "—"}</p>
                <details className="mt-2"><summary className="cursor-pointer text-primary">Ver datos del evento</summary><pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify({ resumen_cambio: event.resumen_cambio, identificadores_relacionados: event.identificadores_relacionados }, null, 2)}</pre></details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
