import type { Metadata } from "next"

import { ClienteDatos } from "@/components/clientes/cliente-datos"

export const metadata: Metadata = { title: "Cliente" }

export default async function Page({ params }: PageProps<"/admin/clientes/[id]">) {
  const { id } = await params
  return <ClienteDatos id={id} />
}
