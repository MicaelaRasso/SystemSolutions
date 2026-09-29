import type { Metadata } from "next"
import { AuditLog } from "@/components/admin/audit-log"
export const metadata: Metadata = { title: "Auditoría" }
export default function Page() { return <AuditLog /> }
