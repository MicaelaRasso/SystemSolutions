"use client"

import { ShieldX } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/lib/auth/auth-provider"
import { ROL_LABEL, RUTA_INICIO } from "@/lib/domain/rules"

export function SinAcceso() {
  const { sesion, logout } = useAuth()
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-md space-y-5 text-center">
        <div className="mx-auto w-fit rounded-full bg-destructive/10 p-4">
          <ShieldX className="size-8 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">No tenés acceso a esta sección</h1>
          <p className="text-sm text-muted-foreground">
            {sesion
              ? `Ingresaste como ${ROL_LABEL[sesion.rol]}. Esta página corresponde a otro perfil.`
              : "Esta página corresponde a otro perfil de usuario."}
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button asChild>
            <Link href={sesion ? RUTA_INICIO[sesion.rol] : "/login"}>Ir a mi inicio</Link>
          </Button>
          {sesion && (
            <Button variant="outline" onClick={logout}>
              Cambiar de cuenta
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
