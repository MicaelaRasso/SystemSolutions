import type { Metadata } from "next"

import { EnConstruccion } from "@/components/common/states"

export const metadata: Metadata = { title: "Mi empresa" }

export default function Page() {
  return (
    <EnConstruccion titulo="Mi empresa" fase={7} detalle="Datos de la empresa y carga del logo." />
  )
}
