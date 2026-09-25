import type { Metadata } from "next"

import { UsuariosCliente } from "@/components/clientes/usuarios-cliente"

export const metadata: Metadata = { title: "Usuarios del cliente" }

export default async function Page({ params }: PageProps<"/admin/clientes/[id]/usuarios">) {
  const { id } = await params
  return <UsuariosCliente empresaId={id} />
}
