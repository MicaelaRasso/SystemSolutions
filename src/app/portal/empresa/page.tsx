import type { Metadata } from "next"

import { ClienteEmpresaPortal } from "@/components/clientes/cliente-empresa-portal"

export const metadata: Metadata = { title: "Mi empresa" }

export default function Page() {
  return <ClienteEmpresaPortal />
}
