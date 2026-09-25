import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Panel" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Panel"
      fase={8}
      detalle="Métricas de actividad: certificados generados, servicios completados y próximos vencimientos."
    />
  )
}
