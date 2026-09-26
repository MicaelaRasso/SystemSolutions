import type { Metadata } from "next"

import { PageHeader } from "@/components/common/page-header"
import { SincronizacionPanel } from "@/components/talleres/sincronizacion-panel"

export const metadata: Metadata = { title: "Sincronización" }

export default function Page() {
  return <><PageHeader titulo="Sincronización" descripcion="Estado local y sincronización de trabajo de campo." /><SincronizacionPanel /></>
}
