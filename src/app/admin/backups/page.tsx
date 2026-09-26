import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { requerirSesion } from "@/lib/auth/server"

export const metadata: Metadata = { title: "Backup manual" }

export default async function Page() {
  await requerirSesion(["superadmin"])
  redirect("/superadmin/backups")
}
