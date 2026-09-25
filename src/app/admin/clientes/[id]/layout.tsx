import { ClienteHeader } from "@/components/clientes/cliente-header"

export default async function Layout({ children, params }: LayoutProps<"/admin/clientes/[id]">) {
  const { id } = await params
  return (
    <>
      <ClienteHeader id={id} />
      {children}
    </>
  )
}
