import type { Metadata } from "next"

import { TareasList } from "@/components/tareas/tareas-list"

export const metadata: Metadata = { title: "Tareas" }

export default function Page() {
  return <TareasList />
}
