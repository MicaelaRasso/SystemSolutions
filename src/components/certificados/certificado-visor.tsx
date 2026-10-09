"use client"

import { FileDown, Lock } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { createPortal, flushSync } from "react-dom"

import { Button } from "@/components/ui/button"
import type { PermisoImpresionCertificado } from "@/lib/domain/rules"

import { CertificadoDocumento } from "./certificado-documento"
import type { CertificadoVista } from "./certificado-vista"

/**
 * Vista previa A4 del certificado con la descarga en PDF por el diálogo de impresión del
 * navegador. Mientras se imprime monta una copia como hija directa de <body> (las reglas
 * de `globals.css` ocultan el resto) y usa el nombre de archivo del certificado como
 * título del documento, que el navegador propone como nombre del PDF.
 */
export function CertificadoVisor({
  vista,
  permiso,
  acciones,
}: {
  vista: CertificadoVista
  permiso: PermisoImpresionCertificado
  acciones?: React.ReactNode
}) {
  const [imprimiendo, setImprimiendo] = useState(false)
  const motivoId = useId()
  const { puedeImprimir, requiereFirma, motivo } = permiso

  useEffect(() => {
    if (!puedeImprimir) return
    let tituloAnterior: string | null = null
    const antes = () => {
      tituloAnterior = document.title
      document.title = vista.nombreArchivo
      flushSync(() => setImprimiendo(true))
    }
    const despues = () => {
      if (tituloAnterior !== null) document.title = tituloAnterior
      tituloAnterior = null
      setImprimiendo(false)
    }
    window.addEventListener("beforeprint", antes)
    window.addEventListener("afterprint", despues)
    return () => {
      window.removeEventListener("beforeprint", antes)
      window.removeEventListener("afterprint", despues)
      if (tituloAnterior !== null) document.title = tituloAnterior
    }
  }, [puedeImprimir, vista.nombreArchivo])

  return (
    <section aria-label="Vista del certificado" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => window.print()}
          disabled={!puedeImprimir}
          aria-describedby={motivo ? motivoId : undefined}
        >
          <FileDown />
          Descargar PDF
        </Button>
        {acciones}
        {puedeImprimir && (
          <p className="text-xs text-muted-foreground">
            En el diálogo de impresión, elija «Guardar como PDF». Nombre sugerido:{" "}
            <span className="font-mono">{vista.nombreArchivo}.pdf</span>
          </p>
        )}
      </div>

      {motivo && (
        <p
          id={motivoId}
          className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          {motivo}
        </p>
      )}

      <div className="overflow-auto rounded-xl border bg-muted/50 p-3 sm:p-6 print:hidden">
        <div className="mx-auto w-fit border shadow-sm">
          <CertificadoDocumento vista={vista} requiereFirma={requiereFirma} />
        </div>
      </div>
      {!puedeImprimir && (
        <p className="hidden print:block">La impresión de este certificado no está habilitada.</p>
      )}

      {imprimiendo &&
        createPortal(
          <div data-certificado-impresion className="hidden print:block">
            <CertificadoDocumento vista={vista} requiereFirma={requiereFirma} />
          </div>,
          document.body,
        )}
    </section>
  )
}
