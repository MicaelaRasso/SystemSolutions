"use client"

import { useEffect, useState } from "react"

import { edgeApi } from "@/lib/api"
import { browserSupabase } from "@/lib/services/edge-transport"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function SeguridadCuenta({ verificationStatus }: { verificationStatus: string | null }) {
  const [currentEmail, setCurrentEmail] = useState<string | null>(null)
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void browserSupabase().auth.getUser().then(({ data, error: userError }) => {
      if (!userError) {
        setCurrentEmail(data.user?.email ?? null)
        setEmail(data.user?.email ?? "")
      }
      setLoading(false)
    })
  }, [])

  async function requestChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    setError(null)
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Ingresá un email válido.")
      return
    }
    if (email.trim().toLowerCase() === currentEmail?.toLowerCase()) {
      setError("Ingresá un email distinto al actual.")
      return
    }

    setSubmitting(true)
    try {
      await edgeApi.identity.requestEmailChange(
        email,
        `${window.location.origin}/cuenta/seguridad`,
      )
      setMessage("Enviamos enlaces de verificación al email actual y al nuevo. Confirmá ambos para completar el cambio.")
    } catch {
      setError("No se pudo iniciar el cambio. Revisá el email e intentá nuevamente.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Seguridad de la cuenta</h1>
        <p className="text-sm text-muted-foreground">Administrá el email de acceso y recuperá tu contraseña desde la pantalla de ingreso.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Cambiar email de la cuenta</CardTitle>
          <CardDescription>Para proteger la cuenta, el nuevo email debe verificarse antes de que se aplique el cambio.</CardDescription>
        </CardHeader>
        <CardContent>
          {currentEmail && <p className="mb-4 text-sm text-muted-foreground">Email actual: <span className="font-medium text-foreground">{currentEmail}</span></p>}
          <form className="space-y-4" onSubmit={(event) => void requestChange(event)}>
            <div className="space-y-2">
              <Label htmlFor="account-email">Nuevo email</Label>
              <Input id="account-email" type="email" autoComplete="email" required disabled={loading || submitting} value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            {message && <p role="status" className="text-sm text-green-700">{message}</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {verificationStatus === "verified" && (
              <p role="status" className="text-sm text-green-700">
                Se procesó el enlace de verificación. Si recibiste un segundo enlace en el email actual, confirmalo para completar el cambio.
              </p>
            )}
            {verificationStatus === "invalid" && (
              <p role="alert" className="text-sm text-destructive">
                El enlace de cambio de email venció o ya fue usado. Iniciá una nueva solicitud.
              </p>
            )}
            <Button type="submit" disabled={loading || submitting || !currentEmail}>
              {submitting ? "Enviando verificación…" : "Solicitar cambio de email"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
