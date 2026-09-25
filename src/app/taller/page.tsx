import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Mis tareas" }

export default function Page() {
  return (
    <EnConstruccion
      titulo="Mis tareas"
      fase={5}
      detalle="Tareas asignadas al taller y carga de certificados en campo."
    />
  )
}
