import type { Metadata } from "next"

import { SeguridadCuenta } from "@/components/account/seguridad-cuenta"

export const metadata: Metadata = { title: "Seguridad de la cuenta" }

export default async function Page(props: PageProps<"/cuenta/seguridad">) {
  const params = await props.searchParams
  const status = typeof params.emailChange === "string" ? params.emailChange : null
  return <SeguridadCuenta verificationStatus={status} />
}
