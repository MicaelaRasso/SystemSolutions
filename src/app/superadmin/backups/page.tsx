import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Backups por fecha" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Backups por fecha"
      fase={8}
      detalle="Backup manual de la información filtrado por fecha."
    />
  )
}
