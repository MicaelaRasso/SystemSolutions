import { runtimeEnv } from "./runtime-env.ts"

type AdminClient = {
  auth: {
    admin: {
      inviteUserByEmail(email: string, options?: { data?: Record<string, unknown> }): Promise<{ data: { user: { id: string } | null }; error: { message: string } | null }>
      updateUserById(id: string, attributes: { email?: string; user_metadata?: Record<string, unknown> }): Promise<{ error: { message: string } | null }>
      deleteUser(id: string): Promise<{ error: { message: string } | null }>
    }
  }
}

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
