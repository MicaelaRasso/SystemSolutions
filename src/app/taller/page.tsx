import type { Metadata } from "next"

import { VisitasPanel } from "@/components/talleres/visitas-panel"

export const metadata: Metadata = { title: "Mis visitas de servicio" }

export default function Page() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mis visitas de servicio</h1>
        <p className="mt-1 text-sm text-muted-foreground">Trabajo de campo, Órdenes de trabajo y captura de certificados.</p>
      </div>
      <VisitasPanel />
    </div>
  )
}
