import type { Metadata } from "next"

import { AdminDashboard } from "@/components/admin/dashboard"

export const metadata: Metadata = { title: "Panel" }

export default function Page() {
  return <AdminDashboard />
}
