import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Administradores" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Administradores"
      fase={8}
      detalle="Alta y baja de cuentas de Administrador."
    />
  )
}
