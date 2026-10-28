import type { Metadata } from "next"
import { cookies } from "next/headers"

import { Logo } from "@/components/brand/logo"

import { SetupPasswordForm } from "./setup-password-form"

export const metadata: Metadata = { title: "Configurar contraseña" }

export default async function SetupPasswordPage() {
  const cookieStore = await cookies()
  const invitationUserId = cookieStore.get("ss_invitation_setup_user")?.value ?? null

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10 sm:px-8">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3">
          <Logo className="text-xl" />
          <h1 className="text-2xl font-semibold tracking-tight">Configurá tu contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Elegí una contraseña para activar tu acceso a System Solutions.
          </p>
        </div>
        <SetupPasswordForm invitationUserId={invitationUserId} />
      </div>
    </main>
  )
}
