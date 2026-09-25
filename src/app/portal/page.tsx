import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Calendario" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Calendario"
      fase={7}
      detalle="Agenda mensual de turnos de tu empresa."
    />
  )
}
