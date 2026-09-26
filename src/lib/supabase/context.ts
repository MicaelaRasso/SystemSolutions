import type { Rol, Sesion } from "@/lib/domain/types"

import { getSupabaseConfig } from "./config"

export type EdgeContext = {
  cuenta_id: string
  rol: "cliente" | "taller_movil" | "administrador_regular" | "super_administrador"
  taller_movil_id: string | null
  cliente: boolean
}

const roleMap: Record<EdgeContext["rol"], Rol> = {
  cliente: "cliente",
  taller_movil: "taller",
  administrador_regular: "admin",
  super_administrador: "superadmin",
}

function isEdgeContext(value: unknown): value is EdgeContext {
  if (!value || typeof value !== "object") return false
  const context = value as Partial<EdgeContext>
  return (
    typeof context.cuenta_id === "string" &&
    typeof context.rol === "string" &&
    context.rol in roleMap &&
    (typeof context.taller_movil_id === "string" || context.taller_movil_id === null) &&
    typeof context.cliente === "boolean"
  )
}

/**
 * Role and account information comes exclusively from the authenticated Edge
 * gateway. It must never be inferred from a browser cookie or user metadata.
 */
export async function getAuthenticatedContext(accessToken: string): Promise<EdgeContext | null> {
  const config = getSupabaseConfig()
  let response: Response
  try {
    response = await fetch(`${config.edgeFunctions["identity-admin"]}/context`, {
      cache: "no-store",
      headers: {
        apikey: config.publishableKey,
        authorization: `Bearer ${accessToken}`,
      },
    })
  } catch {
    return null
  }

  if (!response.ok) return null

  const payload: unknown = await response.json().catch(() => null)
  // PostgREST returns a one-row table as an array; tolerate the object shape
  // used by the existing Edge adapter while its contract is being migrated.
  const context = Array.isArray(payload) ? payload[0] : payload
  return isEdgeContext(context) ? context : null
}

export function sesionDesdeContexto(context: EdgeContext, exp: number): Sesion {
  return {
    usuarioId: context.cuenta_id,
    rol: roleMap[context.rol],
    // The current context endpoint intentionally exposes authorization data,
    // not profile data. The client session supplies a display name separately.
    nombre: "",
    exp: exp * 1_000,
  }
}
