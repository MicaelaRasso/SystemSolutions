import { ChevronLeft } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { EmpresaForm } from "@/components/clientes/empresa-form"
import { PageHeader } from "@/components/common/page-header"

export const metadata: Metadata = { title: "Nuevo cliente" }

export default function Page() {
  return (
    <>
      <Link
        href="/admin/clientes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Clientes
      </Link>
      <PageHeader
        titulo="Nuevo cliente"
        descripcion="Después de crearlo vas a poder cargar su logo, sus yacimientos y sus usuarios."
      />
      <EmpresaForm />
    </>
  )
}
