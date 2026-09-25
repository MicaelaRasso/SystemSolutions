import type { Metadata } from "next"

import { Logo } from "@/components/brand/logo"

import { LoginForm } from "./login-form"

export const metadata: Metadata = { title: "Ingresar" }

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams
  const next = typeof params.next === "string" ? params.next : null
  const expirada = params.expirada === "1"

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Logo variant="light" className="self-start text-2xl" />
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold text-white">
            Mantenimiento y calibración de válvulas de seguridad
          </h2>
          <p className="text-sidebar-foreground/80">
            Agenda de talleres móviles, certificados digitales firmados en campo y acceso de cada
            cliente a sus certificados vigentes.
          </p>
        </div>
        <p className="text-xs text-sidebar-foreground/60">
          System Solutions SRL · Neuquén · Más de 20 años en instrumentación y control
        </p>
        <div
          aria-hidden
          className="absolute -right-32 -bottom-40 size-[28rem] rounded-full border-[3rem] border-sidebar-primary/15"
        />
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-2">
            <Logo className="text-xl lg:hidden" />
            <h1 className="text-2xl font-semibold tracking-tight">Ingresar</h1>
            <p className="text-sm text-muted-foreground">
              Usá el email y la contraseña de tu cuenta.
            </p>
          </div>
          <LoginForm next={next} expirada={expirada} />
        </div>
      </main>
    </div>
  )
}
