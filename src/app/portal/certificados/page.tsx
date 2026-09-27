import type { Metadata } from "next"

import { CertificadosPortal } from "@/components/clientes/certificados-portal"
import { FirmaPendientePanel } from "@/components/clientes/firma-pendiente-panel"

export const metadata: Metadata = { title: "Certificados" }

export default function Page() {
  return <div className="space-y-6"><div><h1 className="text-2xl font-semibold tracking-tight">Certificados</h1><p className="mt-1 text-sm text-muted-foreground">Certificados finalizados, pendientes de firma e historial de tus Válvulas.</p></div><FirmaPendientePanel /><CertificadosPortal /></div>
}
