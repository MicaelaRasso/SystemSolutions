import { HttpError } from "./errors.ts"
import { runtimeEnv, type RuntimeEnv } from "./runtime-env.ts"

export type AuthenticatedActor = {
  id: string
  authorization: string
}

export type GetUser = (authorization: string, env: RuntimeEnv) => Promise<{ id: string } | null>

export const bearerAuthorization = (authorization: string | null) => {
  if (!authorization || !/^Bearer\s+\S+$/i.test(authorization)) return null
  return authorization
}

const defaultGetUser: GetUser = async (authorization, env) => {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
    const client = createClient(env.SUPABASE_URL!, env.SUPABASE_ANON_KEY!, {
      global: { headers: { authorization } },
    })
    const {
      data: { user },
      error,
    } = await client.auth.getUser()
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

  const env = dependencies.env ?? runtimeEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new HttpError(500, "Supabase authentication is not configured")
  }

  const user = await (dependencies.getUser ?? defaultGetUser)(authorization, env)
  if (!user) throw new HttpError(401, "Authentication required")

  return { id: user.id, authorization }
}
