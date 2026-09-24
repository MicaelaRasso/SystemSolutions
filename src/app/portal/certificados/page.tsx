import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Certificados" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Certificados"
      fase={7}
      detalle="Certificados vigentes con búsqueda por equipo, tag, fecha y locación."
    />
  )
}
