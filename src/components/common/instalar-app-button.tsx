"use client"

import { Download } from "lucide-react"
import { useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  instalacionPwa,
  plataformaInstalacion,
  type EstadoInstalacion,
  type PlataformaInstalacion,
  type ResultadoInstalacion,
} from "@/lib/pwa/install-store"

export async function ejecutarInstalacion(
  instalar: () => Promise<ResultadoInstalacion>,
  abrirInstrucciones: () => void,
) {
  const resultado = await instalar()
  if (resultado === "aceptada") toast.success("La app se está instalando")
  if (resultado === "rechazada") toast.info("Instalación cancelada")
  if (resultado === "error") toast.error("No se pudo abrir el instalador")
  if (resultado === "manual" || resultado === "error") abrirInstrucciones()
}

export function InstruccionesInstalacion({ plataforma }: { plataforma: PlataformaInstalacion }) {
  if (plataforma === "ios") {
    return (
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Abrí esta página en Safari.</li>
        <li>Tocá el botón Compartir.</li>
        <li>Elegí «Agregar a inicio».</li>
      </ol>
    )
  }
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm">
      <li>Abrí el menú del navegador.</li>
      <li>Elegí «Instalar app» o «Agregar a la pantalla principal».</li>
      <li>Si no aparece, probá con Chrome o Edge. También puede que ya esté instalada.</li>
    </ol>
  )
}

export function InstalarAppVista({
  estado,
  plataforma,
  onInstalar,
  onCerrar,
}: {
  estado: EstadoInstalacion
  plataforma: PlataformaInstalacion | null
  onInstalar: () => void
  onCerrar: () => void
}) {
  if (estado === "desconocido" || estado === "instalada") return null

  return (
    <>
      <Button variant="outline" size="sm" className="ml-auto" onClick={onInstalar}>
        <Download />
        Instalar app
      </Button>
      <Dialog open={plataforma !== null} onOpenChange={(abierto) => !abierto && onCerrar()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Instalar System Solutions</DialogTitle>
            <DialogDescription>
              Tu navegador no ofrece la instalación directa. Se hace en pocos pasos:
            </DialogDescription>
          </DialogHeader>
          {plataforma && <InstruccionesInstalacion plataforma={plataforma} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

export function InstalarAppButton() {
  const estado = useSyncExternalStore(
    instalacionPwa.subscribe,
    instalacionPwa.getSnapshot,
    instalacionPwa.getServerSnapshot,
  )
  const [plataforma, setPlataforma] = useState<PlataformaInstalacion | null>(null)

  return (
    <InstalarAppVista
      estado={estado}
      plataforma={plataforma}
      onInstalar={() =>
        void ejecutarInstalacion(instalacionPwa.instalar, () =>
          setPlataforma(plataformaInstalacion(navigator)),
        )
      }
      onCerrar={() => setPlataforma(null)}
    />
  )
}
