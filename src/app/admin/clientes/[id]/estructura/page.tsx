import type { Metadata } from "next"

import { EstructuraEditor } from "@/components/estructura/estructura-editor"

export const metadata: Metadata = { title: "Estructura del cliente" }

export default async function Page({ params }: PageProps<"/admin/clientes/[id]/estructura">) {
  const { id } = await params
  return <EstructuraEditor empresaId={id} />
}
