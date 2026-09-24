import type { Metadata } from "next"

import { TareaDetalle } from "@/components/tareas/tarea-detalle"

export const metadata: Metadata = { title: "Tarea" }

export default async function Page({ params }: PageProps<"/admin/tareas/[id]">) {
  const { id } = await params
  return <TareaDetalle id={id} />
}
