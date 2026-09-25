import type { Metadata } from "next"

import { TalleresAdmin } from "@/components/talleres/talleres-admin"

export const metadata: Metadata = { title: "Talleres y personal" }

export default function Page() {
  return <TalleresAdmin />
}
