"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Clock, Info } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/lib/auth/auth-provider"
import { ROL_LABEL } from "@/lib/domain/rules"
import { loginSchema, type LoginInput } from "@/lib/domain/schemas"
import type { Rol } from "@/lib/domain/types"
import { mensajeError } from "@/lib/hooks/queries"
import { DEMO_PASSWORD } from "@/lib/services/mock/seed"

const CUENTAS_DEMO: { email: string; rol: Rol; detalle: string }[] = [
  { email: "superadmin@systemsrl.com.ar", rol: "superadmin", detalle: "Acceso total" },
  { email: "admin@systemsrl.com.ar", rol: "admin", detalle: "Administración SYS" },
  { email: "taller1@systemsrl.com.ar", rol: "taller", detalle: "Tablet del Taller Móvil 1" },
  {
    email: "cliente@compresionpatagonica.com.ar",
    rol: "cliente",
    detalle: "Compresión Patagónica",
  },
]

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

  function usarCuenta(email: string) {
    form.setValue("email", email, { shouldValidate: true })
    form.setValue("password", DEMO_PASSWORD, { shouldValidate: true })
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

      <section className="space-y-3 rounded-xl border bg-muted/40 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Info className="size-4 text-primary" />
          Cuentas de demostración
        </div>
        <p className="text-xs text-muted-foreground">
          Contraseña para todas: <code className="font-mono">{DEMO_PASSWORD}</code>
        </p>
        <ul className="grid gap-1.5">
          {CUENTAS_DEMO.map((c) => (
            <li key={c.email}>
              <button
                type="button"
                onClick={() => usarCuenta(c.email)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <span className="font-medium">{ROL_LABEL[c.rol]}</span>
                <span className="text-muted-foreground"> · {c.detalle}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
