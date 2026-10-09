import type { Metadata } from "next"

import { PageHeader } from "@/components/common/page-header"
import { CertificadoCliente } from "@/components/portal/certificado-cliente"

export const metadata: Metadata = { title: "Certificado" }

export default async function Page(props: PageProps<"/portal/certificados/[id]">) {
  const { id } = await props.params
  const { valvula } = await props.searchParams
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Certificado"
        descripcion="Vista del certificado con el formato del modelo SYS."
      />
      <CertificadoCliente
        certificadoId={id}
        valvulaId={typeof valvula === "string" ? valvula : undefined}
      />
    </div>
  )
}
