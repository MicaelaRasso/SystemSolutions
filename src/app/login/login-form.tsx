"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Clock } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth/auth-provider"
import { loginSchema, type LoginInput } from "@/lib/domain/schemas"
import { mensajeError } from "@/lib/hooks/queries"
import { edgeApi } from "@/lib/api"

export function LoginForm({
  next,
  expirada,
  invitacionInvalida,
  recuperacionInvalida,
}: {
  next: string | null
  expirada: boolean
  invitacionInvalida: boolean
  recuperacionInvalida: boolean
}) {
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [resetRequested, setResetRequested] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })
  const { errors, isSubmitting } = form.formState

  async function onSubmit(data: LoginInput) {
    setError(null)
    try {
      await login(data.email, data.password, next)
    } catch (e) {
      setError(mensajeError(e))
    }
  }

  async function requestPasswordReset() {
    setResetRequested(false)
    const email = loginSchema.shape.email.safeParse(form.getValues("email"))
    if (!email.success) {
      form.setError("email", { message: "Ingresá un email válido para recuperar la contraseña." })
      return
    }

    setResetSubmitting(true)
    try {
      await edgeApi.identity.requestPasswordReset(
        email.data,
        `${window.location.origin}/reset-password`,
      )
    } catch {
      // Keep account existence and request outcomes private in the UI.
    } finally {
      setResetRequested(true)
      setResetSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          {expirada && !error && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <Clock className="mt-0.5 size-4 shrink-0" />
              Tu sesión expiró. Ingresá nuevamente para continuar.
            </div>
          )}
          {invitacionInvalida && !error && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            >
              El enlace de invitación venció o ya fue usado. Pedí que te envíen uno nuevo.
            </div>
          )}
          {recuperacionInvalida && !error && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              El enlace de recuperación venció o ya fue usado. Solicitá uno nuevo.
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </div>
          )}
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              aria-invalid={!!errors.email}
              {...form.register("email")}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password">Contraseña</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...form.register("password")}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting ? "Ingresando…" : "Ingresar"}
          </Button>
          <div className="space-y-2 pt-1">
            <Button type="button" variant="link" className="h-auto px-0" disabled={resetSubmitting} onClick={() => void requestPasswordReset()}>
              {resetSubmitting ? "Enviando…" : "Olvidé mi contraseña"}
            </Button>
            {resetRequested && (
              <p role="status" className="text-sm text-muted-foreground">
                Si existe una cuenta con ese email, vas a recibir instrucciones para recuperar el acceso.
                Revisá también la carpeta de correo no deseado.
              </p>
            )}
          </div>
        </FieldGroup>
      </form>
    </div>
  )
}
