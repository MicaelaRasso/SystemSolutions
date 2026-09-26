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

export function LoginForm({ next, expirada }: { next: string | null; expirada: boolean }) {
  const { login } = useAuth()
  const [error, setError] = useState<string | null>(null)
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
        </FieldGroup>
      </form>
    </div>
  )
}
