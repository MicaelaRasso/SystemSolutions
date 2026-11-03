import { actorHeaders } from "./actor.ts"
import { HttpError, type DatabaseError } from "./errors.ts"
import { runtimeEnv, type RuntimeEnv } from "./runtime-env.ts"

export type RpcResult = {
  data: unknown
  error: DatabaseError | null
}

export type ServiceRoleClient = {
  rpc(name: string, args?: Record<string, unknown>): Promise<RpcResult>
}

let supabaseJsPromise: Promise<typeof import("https://esm.sh/@supabase/supabase-js@2.117.2")> | undefined

const loadSupabaseJs = () => {
  supabaseJsPromise ??= import("https://esm.sh/@supabase/supabase-js@2.117.2")
  return supabaseJsPromise
}

export const createServiceRoleClient = async ({
  actorId,
  correlationId,
  functionName,
  env = runtimeEnv(),
}: {
  actorId: string
  correlationId: string
  functionName: string
  env?: RuntimeEnv
}): Promise<ServiceRoleClient> => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new HttpError(500, "Supabase service access is not configured")
  }

  const { createClient } = await loadSupabaseJs()
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    global: {
      headers: actorHeaders({ actorId, correlationId, functionName }),
    },
  }) as ServiceRoleClient
}
