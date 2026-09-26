import type { EdgeAccessClient } from "../services/edge"
import { edgeContextSchema } from "./contracts"

export const identityQueryKeys = {
  context: () => ["edge", "identity", "context"] as const,
}

export const identityInvalidations = [["edge"]] as const

export function createIdentityApi(edge: EdgeAccessClient) {
  return { context: () => edge.request("context", edgeContextSchema) }
}

export type IdentityApi = ReturnType<typeof createIdentityApi>
