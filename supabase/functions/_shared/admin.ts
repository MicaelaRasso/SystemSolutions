import { runtimeEnv } from "./runtime-env.ts"
import { isAllowedOrigin } from "./cors.ts"

type AdminClient = {
  auth: {
    admin: {
      inviteUserByEmail(email: string, options?: { data?: Record<string, unknown>; redirectTo?: string }): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      updateUserById(id: string, attributes: { email?: string; user_metadata?: Record<string, unknown> }): Promise<{ error: { message: string } | null }>
      deleteUser(id: string): Promise<{ error: { message: string } | null }>
    }
  }
}

const accountEmailRedirectTo = (request: Request, path: string): string | undefined => {
  const env = runtimeEnv()
  const configured = env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN
  const candidates = (configured ?? "").split(",").map((value) => value.trim()).filter(Boolean)
  const origin = request.headers.get("origin")
  const selected = isAllowedOrigin(origin, configured) ? origin : candidates[0]
  if (!selected) return undefined
  try {
    const url = new URL(selected)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return new URL(path, url.origin).toString()
  } catch {
    return undefined
  }
}

export const invitationRedirectTo = (request: Request) => accountEmailRedirectTo(request, "/setup-password")
export const passwordRecoveryRedirectTo = (request: Request) => accountEmailRedirectTo(request, "/reset-password")

/** Secret-key Auth operations stay inside Edge Functions; the browser never sees this client. */
export const createAuthAdmin = async (): Promise<AdminClient> => {
  const env = runtimeEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
    throw new Error("Supabase service access is not configured")

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AdminClient
}

export const requireCreatedUser = (user: { id: string } | null, message: string) => {
  if (!user?.id) throw new Error(message)
  return user.id
}
