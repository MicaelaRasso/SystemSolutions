"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { browserSupabase } from "@/lib/services/edge-transport"

export function ResetPasswordForm() {
  const router = useRouter()
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    void browserSupabase().auth.getSession().then(({ data, error: sessionError }) => {
      setHasSession(!sessionError && !!data.session)
    })
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (password.length < 12) {
      setError("La contraseña debe tener al menos 12 caracteres.")
      return
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.")
      return
    }

    setIsSubmitting(true)
    const { error: updateError } = await browserSupabase().auth.updateUser({ password })
    if (updateError) {
      setError("No se pudo actualizar la contraseña. Solicitá un nuevo enlace de recuperación.")
      setIsSubmitting(false)
      return
    }
    router.replace("/login")
  }

  if (hasSession === null) {
    return <p className="text-sm text-muted-foreground" role="status">Verificando el enlace…</p>
  }

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          El enlace venció o ya fue usado. Solicitá uno nuevo desde la página de ingreso.
        </p>
        <Button type="button" variant="outline" onClick={() => router.replace("/login")}>
          Ir a ingresar
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        {error && <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{error}</p>}
        <Field>
          <FieldLabel htmlFor="new-password">Contraseña nueva</FieldLabel>
          <Input id="new-password" type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm-password">Repetir contraseña</FieldLabel>
          <Input id="confirm-password" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </Field>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Actualizar contraseña"}
        </Button>
      </FieldGroup>
    </form>
  )
}
