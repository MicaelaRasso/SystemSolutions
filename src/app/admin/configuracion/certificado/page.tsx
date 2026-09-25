import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Configuración del certificado" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Configuración del certificado"
      fase={8}
      detalle="Campos del certificado configurables desde el panel."
    />
  )
}
