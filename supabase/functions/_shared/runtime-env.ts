export type RuntimeEnv = Record<string, string | undefined>

const namedKey = (value: string | undefined): string | undefined => {
  if (!value) return undefined

  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined

    const values = Object.values(parsed as Record<string, unknown>)
    return values.find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
    )
  } catch {
    return undefined
  }
}

const readKey = (
  get: (name: string) => string | undefined,
  singularName: string,
  pluralName: string,
) => get(singularName) ?? namedKey(get(pluralName))

export const runtimeEnv = (): RuntimeEnv => {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env: { get(name: string): string | undefined } }
    }
  ).Deno
  const get = (name: string) => deno?.env.get(name)

  return {
    ALLOWED_ORIGINS: deno?.env.get("ALLOWED_ORIGINS"),
    ALLOWED_ORIGIN: deno?.env.get("ALLOWED_ORIGIN"),
    SUPABASE_PUBLISHABLE_KEY: readKey(get, "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEYS"),
    SUPABASE_SECRET_KEY: readKey(get, "SUPABASE_SECRET_KEY", "SUPABASE_SECRET_KEYS"),
    SUPABASE_JWKS_URL: deno?.env.get("SUPABASE_JWKS_URL"),
    SUPABASE_URL: deno?.env.get("SUPABASE_URL"),
    BACKUP_MAX_ARCHIVE_BYTES: deno?.env.get("BACKUP_MAX_ARCHIVE_BYTES"),
    BACKUP_MAX_DURATION_MS: deno?.env.get("BACKUP_MAX_DURATION_MS"),
  }
}
