import type { Metadata } from "next"

import { Cronograma } from "@/components/cronograma/cronograma"

export const metadata: Metadata = { title: "Cronograma" }

export default function Page() {
  return <Cronograma />
}
