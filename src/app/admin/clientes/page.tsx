import type { Metadata } from "next"

import { ClientesList } from "@/components/clientes/clientes-list"

export const metadata: Metadata = { title: "Clientes" }

export default function Page() {
  return <ClientesList />
}
