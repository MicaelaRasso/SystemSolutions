export type RuntimeEnv = Record<string, string | undefined>

export const runtimeEnv = (): RuntimeEnv => {
  const deno = (
    globalThis as typeof globalThis & {
      Deno?: { env: { get(name: string): string | undefined } }
    }
  ).Deno

  return {
    ALLOWED_ORIGINS: deno?.env.get("ALLOWED_ORIGINS"),
    ALLOWED_ORIGIN: deno?.env.get("ALLOWED_ORIGIN"),
    SUPABASE_ANON_KEY: deno?.env.get("SUPABASE_ANON_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: deno?.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    SUPABASE_URL: deno?.env.get("SUPABASE_URL"),
    BACKUP_MAX_ARCHIVE_BYTES: deno?.env.get("BACKUP_MAX_ARCHIVE_BYTES"),
    BACKUP_MAX_DURATION_MS: deno?.env.get("BACKUP_MAX_DURATION_MS"),
  }
}
