import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Backups" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Backups"
      fase={8}
      detalle="Generación y descarga de backup masivo de la información."
    />
  )
}
