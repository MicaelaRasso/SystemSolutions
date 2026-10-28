"use client"

import { FileDown, Lock, Maximize2, Minimize2 } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { createPortal, flushSync } from "react-dom"

import { Button } from "@/components/ui/button"
import type { PermisoImpresionCertificado } from "@/lib/domain/rules"

import { cn } from "@/lib/utils"

import { CertificadoDocumento } from "./certificado-documento"
import { ANCHO_HOJA_A4_PX, escalaParaAncho } from "./certificado-escala"
import type { CertificadoVista } from "./certificado-vista"

/**
 * Muestra la hoja A4 (ancho fijo) ajustada al ancho disponible: en celular y tablet se reduce con
 * `transform: scale` para que se vea completa, sin desplazamiento. Si la reducción es notable se
 * ofrece pasar a tamaño real, con desplazamiento propio dentro del recuadro. Solo afecta la
 * vista en pantalla: la copia de impresión se monta aparte y no pasa por acá.
 */
function HojaAjustada({ children }: { children: React.ReactNode }) {
  const carril = useRef<HTMLDivElement>(null)
  const hoja = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(1)
  const [alto, setAlto] = useState(0)
  const [real, setReal] = useState(false)

  useEffect(() => {
    const el = carril.current
    const pagina = hoja.current
    if (!el || !pagina) return
    const medir = () => {
      setEscala(escalaParaAncho(el.clientWidth))
      setAlto(pagina.offsetHeight)
    }
    const observador = new ResizeObserver(medir)
    observador.observe(el)
    observador.observe(pagina)
    return () => observador.disconnect()
  }, [])

  const reducida = escala < 0.98
  const ajustar = reducida && !real

  return (
    <div className="space-y-2">
      {reducida && (
        <Button
          type="button"
          variant="outline"
          aria-pressed={real}
          onClick={() => setReal((r) => !r)}
          className="print:hidden"
        >
          {real ? <Minimize2 /> : <Maximize2 />}
          {real ? "Ajustar al ancho de la pantalla" : "Ver a tamaño real"}
        </Button>
      )}
      <div className="rounded-xl border bg-muted/50 p-3 sm:p-6 print:hidden">
        <div ref={carril} className={cn(ajustar ? "overflow-hidden" : "overflow-x-auto")}>
          <div
            className="mx-auto"
            style={
              ajustar
                ? { width: ANCHO_HOJA_A4_PX * escala, height: alto * escala }
                : { width: ANCHO_HOJA_A4_PX }
            }
          >
            <div
              ref={hoja}
              className="shadow-sm ring-1 ring-foreground/15"
              style={
                ajustar
                  ? { width: ANCHO_HOJA_A4_PX, transform: `scale(${escala})`, transformOrigin: "top left" }
                  : { width: ANCHO_HOJA_A4_PX }
              }
            >
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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

      <HojaAjustada>
        <CertificadoDocumento vista={vista} requiereFirma={requiereFirma} />
      </HojaAjustada>
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
