import "server-only"

import { redirect } from "next/navigation"

import type { Rol, Sesion } from "@/lib/domain/types"
import { getVerifiedSesion } from "@/lib/supabase/server"

/**
 * Verifies the Supabase Auth JWT and gets the role from identity-admin.
 */
export async function requerirSesion(roles: Rol[]): Promise<Sesion> {
  const sesion = await getVerifiedSesion()

  if (!sesion || sesion.exp <= Date.now()) redirect("/login?expirada=1")
  if (!roles.includes(sesion.rol)) redirect("/sin-acceso")
  return sesion
}
