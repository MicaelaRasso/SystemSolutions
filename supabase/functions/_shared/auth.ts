import { HttpError } from "./errors.ts"
import { runtimeEnv, type RuntimeEnv } from "./runtime-env.ts"

export type AuthenticatedActor = {
  id: string
  authorization: string
}

export type GetUser = (accessToken: string, env: RuntimeEnv) => Promise<{ id: string } | null>

export const bearerAuthorization = (authorization: string | null) => {
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return null
  return authorization
}

const defaultGetUser: GetUser = async (accessToken, env) => {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
    const client = createClient(env.SUPABASE_URL!, env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const {
      data: { user },
      error,
    } = await client.auth.getUser(accessToken)
    if (error) {
      console.error(JSON.stringify({
        event: "supabase_auth_verification_failed",
        code: error.code ?? null,
        message: error.message,
        status: error.status ?? null,
      }))
    }
    return error || !user ? null : { id: user.id }
  } catch {
    return null
  }
}

export const authenticateRequest = async (
  request: Request,
  dependencies: { env?: RuntimeEnv; getUser?: GetUser } = {},
): Promise<AuthenticatedActor> => {
  const authorization = bearerAuthorization(request.headers.get("authorization"))
  if (!authorization) throw new HttpError(401, "Authentication required")
  const accessToken = authorization.replace(/^Bearer\s+/i, "")

  const env = dependencies.env ?? runtimeEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new HttpError(500, "Supabase authentication is not configured")
  }

  const user = await (dependencies.getUser ?? defaultGetUser)(accessToken, env)
  if (!user) throw new HttpError(401, "Authentication required")

  return { id: user.id, authorization }
}
