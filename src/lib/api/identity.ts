import type { EdgeAccessClient } from "../services/edge"
import { edgeContextResponseSchema } from "./contracts"

export const identityQueryKeys = {
  context: () => ["edge", "identity", "context"] as const,
}

export const identityInvalidations = [["edge"]] as const

export function createIdentityApi(edge: EdgeAccessClient) {
  return { context: () => edge.request("context", edgeContextResponseSchema) }
}

export type IdentityApi = ReturnType<typeof createIdentityApi>
