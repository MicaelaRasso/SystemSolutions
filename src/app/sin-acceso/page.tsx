import type { Metadata } from "next"

import { SinAcceso } from "./sin-acceso"

export const metadata: Metadata = { title: "Sin acceso" }

export default function Page() {
  return <SinAcceso />
}
