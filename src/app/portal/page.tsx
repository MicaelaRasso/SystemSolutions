import type { Metadata } from "next"

import { CalendarioCliente } from "@/components/portal/calendario-cliente"

export const metadata: Metadata = { title: "Calendario" }

export default function Page() {
  return <CalendarioCliente />
}
