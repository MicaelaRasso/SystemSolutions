import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Sincronización" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Sincronización"
      fase={6}
      detalle="Cola de certificados cargados sin conexión y estado de sincronización."
    />
  )
}
