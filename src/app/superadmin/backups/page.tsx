import type { Metadata } from "next"

import { ManualBackupPanel } from "@/components/backups/manual-backup-panel"

export const metadata: Metadata = { title: "Backup manual" }

export default function Page() {
  return <ManualBackupPanel />
}
