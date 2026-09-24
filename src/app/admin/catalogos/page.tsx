import type { Metadata } from "next"

import { CatalogosAdmin } from "@/components/catalogos/catalogos-admin"

export const metadata: Metadata = { title: "Catálogos" }

export default function Page() {
  return <CatalogosAdmin />
}
