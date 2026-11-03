/**
 * Configuración del entorno de prueba. Nunca se leen archivos `.env*`: todo sale de variables
 * `E2E_*` explícitas o de los valores por defecto del stack local de Supabase.
 */

export const BASE_URL = "http://localhost:3100"
export const PUERTO_WEB = 3100
export const DIST_DIR = ".next-e2e"

export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:55321"
export const PUBLISHABLE_KEY =
  process.env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
/** JWT de demostración que la CLI de Supabase usa en todo stack local; no sirve en un proyecto real. */
export const SERVICE_ROLE_JWT =
  process.env.E2E_SERVICE_ROLE_JWT ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
export const CONTENEDOR_DB = process.env.E2E_DB_CONTAINER ?? "supabase_db_system-solutions-verif"

/** Secreto fijo solo para pruebas: firma el ticket de sesión sin conexión del build E2E. */
export const OFFLINE_SESSION_SECRET_E2E = "e2e-solo-pruebas-offline-secret-0123456789abcdef"

const PREFIJOS_LOCALES = ["http://127.0.0.1:", "http://localhost:"]

/** Corta la ejecución si una URL de Supabase no apunta a esta máquina. */
export function asegurarUrlLocal(url: string, origen = "E2E_SUPABASE_URL") {
  if (!PREFIJOS_LOCALES.some((prefijo) => url.startsWith(prefijo))) {
    throw new Error(
      `Seguridad E2E: ${origen} debe empezar con http://127.0.0.1: o http://localhost: y vale "${url}"`,
    )
  }
}

/** El contenedor debe ser de la base local de este proyecto, nunca de otro stack de la máquina. */
export function asegurarContenedorPermitido(nombre: string) {
  if (!/^supabase_db_[\w-]+$/.test(nombre) || nombre.includes("evopadel")) {
    throw new Error(`Seguridad E2E: contenedor de base no permitido: "${nombre}"`)
  }
}

const FUNCIONES = {
  NEXT_PUBLIC_ASSET_ACCESS_URL: "asset-access",
  NEXT_PUBLIC_AUDIT_LOG_URL: "audit-log",
  NEXT_PUBLIC_BACKUP_EXPORT_URL: "backup-export",
  NEXT_PUBLIC_CERTIFICATE_FIELD_URL: "certificate-field",
  NEXT_PUBLIC_IDENTITY_ADMIN_URL: "identity-admin",
  NEXT_PUBLIC_OFFLINE_SYNC_URL: "offline-sync",
  NEXT_PUBLIC_SERVICE_WORKFLOW_URL: "service-workflow",
} as const

/** Variables del proceso web. Tienen prioridad sobre `.env.local`, que Next carga pero no pisa. */
export function variablesServidorWeb(): Record<string, string> {
  asegurarUrlLocal(SUPABASE_URL)
  const urlsDeFunciones = Object.fromEntries(
    Object.entries(FUNCIONES).map(([variable, funcion]) => [
      variable,
      `${SUPABASE_URL}/functions/v1/${funcion}`,
    ]),
  )
  return {
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
    ...urlsDeFunciones,
    OFFLINE_SESSION_SECRET: OFFLINE_SESSION_SECRET_E2E,
  }
}
