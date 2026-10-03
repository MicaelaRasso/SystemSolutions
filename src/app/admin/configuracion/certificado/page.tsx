import type { Metadata } from "next"

import { CertificateTemplateEditor } from "@/components/certificados/certificate-template-editor"

export const metadata: Metadata = { title: "Configuración del certificado" }

export default function Page() {
  return <CertificateTemplateEditor />
}
