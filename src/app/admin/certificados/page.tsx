import type { Metadata } from "next"

import { CertificateHistory } from "@/components/admin/certificate-history"

export const metadata: Metadata = { title: "Certificados" }

export default function Page() {
  return <CertificateHistory />
}
