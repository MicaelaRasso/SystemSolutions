import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Turnos" }

// #REVISAR: connect the existing Cliente Turnos view to the shared visit read path when implemented.
export default function Page() {
  return <EnConstruccion titulo="Turnos" fase={7} detalle="Turnos pendientes e histórico." />
}
