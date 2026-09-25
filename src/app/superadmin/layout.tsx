import { AppShell } from "@/components/layout/app-shell"
import { requerirSesion } from "@/lib/auth/server"

export default async function Layout({ children }: { children: React.ReactNode }) {
  const sesion = await requerirSesion(["superadmin"])
  return <AppShell rol={sesion.rol}>{children}</AppShell>
}
