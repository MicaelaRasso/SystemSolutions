"use client"

import { CalendarX2, FileSearch } from "lucide-react"
import Link from "next/link"

import { armarCertificadoVista } from "@/components/certificados/certificado-vista"
import { CertificadoVisor } from "@/components/certificados/certificado-visor"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useEdgeClientCertificateExport, useEdgeValveCertificateHistory } from "@/lib/api/hooks"
import { permisoImpresionCertificado } from "@/lib/domain/rules"
import { ServiceError } from "@/lib/services/contracts"

const volver = (
  <Button asChild variant="outline">
    <Link href="/portal/certificados">Volver a certificados</Link>
  </Button>
)

/**
 * Contenedor del certificado en el portal. Lee el certificado desde el historial de su
 * Válvula y, si está finalizado, pide la exportación del Cliente, que el backend solo
 * entrega firmado por ambas partes. Sin firmas se previsualiza con la leyenda y sin
 * descarga (RN-04, RN-05); vencido no se muestra (RN-06).
 */
export function CertificadoCliente({
  certificadoId,
  valvulaId,
}: {
  certificadoId: string
  valvulaId?: string
}) {
  const historial = useEdgeValveCertificateHistory(valvulaId)
  const entrada = historial.data?.certificates.find(
    (item) => String(item.certificate.id) === certificadoId,
  )
  const finalizado = entrada?.certificate.estado === "finalizado"
  const exportacion = useEdgeClientCertificateExport(finalizado ? certificadoId : undefined)

  if (!valvulaId) {
    return (
      <EmptyState
        icono={FileSearch}
        titulo="Certificado sin Válvula de referencia"
        descripcion="Abra el certificado desde el listado para ver su vista previa."
        accion={volver}
      />
    )
  }
  if (historial.isLoading || (finalizado && exportacion.isLoading)) {
    return <Skeleton className="h-[480px] w-full rounded-xl" />
  }
  if (historial.isError) {
    return <ErrorState error={historial.error} onRetry={() => void historial.refetch()} />
  }
  if (!entrada) {
    return (
      <EmptyState
        icono={FileSearch}
        titulo="Certificado no encontrado"
        descripcion="El certificado no está disponible para su cuenta."
        accion={volver}
      />
    )
  }

  // 404/403 de la exportación: el certificado todavía no cumple las condiciones de descarga.
  const rechazada =
    exportacion.error instanceof ServiceError &&
    (exportacion.error.code === "not_found" || exportacion.error.code === "unauthorized")
  if (exportacion.isError && !rechazada) {
    return <ErrorState error={exportacion.error} onRetry={() => void exportacion.refetch()} />
  }

  const dto = exportacion.data
  const vista = armarCertificadoVista({
    certificate: dto ? (dto.certificate as Record<string, unknown>) : entrada.certificate,
    snapshot: dto?.snapshot ?? undefined,
    signatures: dto?.signatures,
    images: dto?.images,
    clientLogo: dto?.client_logo ?? undefined,
  })
  const permiso = permisoImpresionCertificado({
    rol: "cliente",
    firmas: { tecnico: Boolean(vista.firmas.tecnico), cliente: Boolean(vista.firmas.cliente) },
    vigenciaHasta: dto?.validity.valid_until ?? entrada.validity?.valid_until ?? null,
  })

  if (!permiso.puedeVer) {
    return (
      <EmptyState
        icono={CalendarX2}
        titulo="Certificado no disponible"
        descripcion={permiso.motivo ?? undefined}
        accion={volver}
      />
    )
  }
  return <CertificadoVisor vista={vista} permiso={permiso} acciones={volver} />
}
