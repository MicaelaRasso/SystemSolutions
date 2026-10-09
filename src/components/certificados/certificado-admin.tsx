"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { useEdgeFinalizedCertificate } from "@/lib/api/hooks"
import { permisoImpresionCertificado } from "@/lib/domain/rules"
import { mensajeError } from "@/lib/hooks/queries"

import { armarCertificadoVista } from "./certificado-vista"
import { CertificadoVisor } from "./certificado-visor"

/**
 * Contenedor del certificado para Administración: usa la fila del detalle administrativo y,
 * si está finalizado, la lectura del certificado firmado con sus firmas e imágenes.
 * Administración imprime siempre; sin las dos firmas lleva la leyenda "REQUIERE FIRMA".
 */
export function CertificadoAdmin({
  certificate,
  acciones,
}: {
  certificate: Record<string, unknown>
  acciones?: React.ReactNode
}) {
  const id = String(certificate.id ?? "")
  const finalizado = certificate.estado === "finalizado"
  const firmado = useEdgeFinalizedCertificate(finalizado ? id : undefined)

  if (finalizado && firmado.isLoading) {
    return <Skeleton className="h-[480px] w-full rounded-xl" />
  }

  const dto = firmado.data
  const vista = armarCertificadoVista({
    certificate: dto ? (dto.certificate as Record<string, unknown>) : certificate,
    snapshot: dto?.snapshot ?? undefined,
    signatures: dto?.signatures,
    images: dto?.images,
    clientLogo: dto?.client_logo ?? undefined,
  })
  const permiso = permisoImpresionCertificado({
    rol: "admin",
    firmas: { tecnico: Boolean(vista.firmas.tecnico), cliente: Boolean(vista.firmas.cliente) },
    vigenciaHasta: dto?.validity.valid_until ?? null,
  })

  return (
    <div className="space-y-2">
      {finalizado && firmado.isError && (
        <p role="status" className="text-sm text-muted-foreground">
          No se pudieron leer las firmas del certificado ({mensajeError(firmado.error)}). Se muestra
          con la leyenda de firma pendiente.
        </p>
      )}
      <CertificadoVisor vista={vista} permiso={permiso} acciones={acciones} />
    </div>
  )
}
