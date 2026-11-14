"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { browserSupabase } from "@/lib/services/edge-transport"

function hasRecoveryUrlParams(): boolean {
  if (typeof window === "undefined") return false
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  return (
    search.get("type") === "recovery" ||
    hash.get("type") === "recovery" ||
    search.has("code") ||
    search.has("token_hash") ||
    hash.has("access_token")
  )
}

export function ResetPasswordForm() {
  const router = useRouter()
  const [hasSession, setHasSession] = useState<boolean | null>(null)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [isRecoveryFlow, setIsRecoveryFlow] = useState<boolean>(() => hasRecoveryUrlParams())
  const [confirmActiveSession, setConfirmActiveSession] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    // Los parámetros de recuperación de la URL ya se leen en el inicializador de `isRecoveryFlow`.
    const client = browserSupabase()
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      const valid = !sessionError && !!data.session
      setHasSession(valid)
      setSessionEmail(data.session?.user?.email ?? null)
    })
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryFlow(true)
      }
      if (session) {
        setHasSession(true)
        setSessionEmail(session.user?.email ?? null)
      }
    })
    return () => {
      subscription.subscription.unsubscribe()
    }
  }, [])

  async function signOutCurrentSession() {
    await browserSupabase()
      .auth.signOut()
      .catch(() => undefined)
    router.replace("/login")
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!isRecoveryFlow && !confirmActiveSession) {
      setError(
        `Confirmá que querés cambiar la contraseña de ${sessionEmail ?? "la sesión actual"} o cerrá la sesión antes de continuar.`,
      )
      return
    }
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
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Verificando el enlace…
      </p>
    )
  }

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <p
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
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
        {sessionEmail ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            Cuenta a actualizar:{" "}
            <strong className="font-semibold text-foreground">{sessionEmail}</strong>
          </div>
        ) : null}
        {!isRecoveryFlow ? (
          <div
            role="alert"
            className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          >
            <p className="font-medium">
              Confirmá que querés cambiar la contraseña de{" "}
              <strong>{sessionEmail ?? "la sesión actual"}</strong>.
            </p>
            <p>
              Detectamos una sesión activa sin un enlace de recuperación recién abierto. Si querías
              cambiar la clave de otra cuenta, cerrá primero esta sesión para no sobrescribir tu
              propia contraseña.
            </p>
            <label className="flex items-start gap-2 text-xs font-medium">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmActiveSession}
                onChange={(event) => setConfirmActiveSession(event.target.checked)}
              />
              <span>
                Confirmo que quiero cambiar la contraseña de{" "}
                <strong>{sessionEmail ?? "esta cuenta"}</strong>
              </span>
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void signOutCurrentSession()}
            >
              Cerrar sesión actual
            </Button>
          </div>
        ) : null}
        {error && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {/* Con una sesión normal, los campos aparecen recién después de confirmar (RNF-03). */}
        {isRecoveryFlow || confirmActiveSession ? (
          <>
            <Field>
              <FieldLabel htmlFor="new-password">Contraseña nueva</FieldLabel>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="confirm-password">Repetir contraseña</FieldLabel>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || (!isRecoveryFlow && !confirmActiveSession)}
            >
              {isSubmitting ? "Guardando…" : "Actualizar contraseña"}
            </Button>
          </>
        ) : null}
      </FieldGroup>
    </form>
  )
}
