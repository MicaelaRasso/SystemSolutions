import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Certificados" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Certificados"
      fase={8}
      detalle="Histórico completo de certificados con filtros por cliente, yacimiento, planta y válvula."
    />
  )
}
