import type { Metadata } from "next"

import { TurnosCliente } from "@/components/portal/turnos-cliente"

export const metadata: Metadata = { title: "Turnos" }

export default function Page() {
  return <TurnosCliente />
}
