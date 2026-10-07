import type { Metadata } from "next"

import { Logo } from "@/components/brand/logo"

import { ResetPasswordForm } from "./reset-password-form"

export const metadata: Metadata = { title: "Recuperar contraseña" }

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3">
          <Logo className="text-xl" />
          <h1 className="text-2xl font-semibold tracking-tight">Elegí una contraseña nueva</h1>
          <p className="text-sm text-muted-foreground">
            Usá al menos 12 caracteres para recuperar el acceso a tu cuenta.
          </p>
        </div>
        <ResetPasswordForm />
      </div>
    </main>
  )
}
