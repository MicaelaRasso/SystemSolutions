import type { Metadata } from "next"

import { TurnosPortal } from "@/components/clientes/turnos-portal"

export const metadata: Metadata = { title: "Turnos" }

export default function Page() {
  return <TurnosPortal />
}
