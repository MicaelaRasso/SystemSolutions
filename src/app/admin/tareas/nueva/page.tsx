import { ChevronLeft } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { PageHeader } from "@/components/common/page-header"
import { TareaForm } from "@/components/tareas/tarea-form"

export const metadata: Metadata = { title: "Nueva tarea" }

export default async function Page({ searchParams }: PageProps<"/admin/tareas/nueva">) {
  const params = await searchParams
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)
  const fecha = texto(params.fecha)
  return (
    <>
      <Link
        href="/admin/tareas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Tareas
      </Link>
      <PageHeader
        titulo="Nueva tarea"
        descripcion="El número de solicitud se asigna automáticamente al guardar."
      />
      <TareaForm
        preset={{
          fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : undefined,
          tallerId: texto(params.taller),
        }}
      />
    </>
  )
}
