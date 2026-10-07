import type { Metadata } from "next"

import { AdministradoresPanel } from "@/components/superadmin/administradores-panel"

export const metadata: Metadata = { title: "Administradores" }

export default function Page() {
  return <AdministradoresPanel />
}
