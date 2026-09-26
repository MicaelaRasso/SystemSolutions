export type SupabaseConfig = {
  url: string
  publishableKey: string
  serviceAccessUrl: string
  edgeFunctions: Record<EdgeFunctionName, string>
}

export const edgeFunctionNames = [
  "identity-admin",
  "asset-access",
  "service-workflow",
  "certificate-field",
  "offline-sync",
  "service-access",
] as const

export type EdgeFunctionName = (typeof edgeFunctionNames)[number]

/** The mock data source remains the default until the integration is enabled. */
export function usesSupabaseDataSource() {
  return process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase"
}

/**
 * Shared public configuration for the Auth clients and the Edge gateway.
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains supported while deployments migrate
 * to Supabase's current publishable-key name.
 */
export function getSupabaseConfig(): SupabaseConfig {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !publishableKey) {
    throw new Error(
      "Supabase Auth requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    )
  }

  const serviceAccessUrl =
    process.env.NEXT_PUBLIC_SERVICE_ACCESS_URL ??
    `${url.replace(/\/$/, "")}/functions/v1/service-access`
  const edgeFunctions: Record<EdgeFunctionName, string> = {
    "identity-admin": process.env.NEXT_PUBLIC_IDENTITY_ADMIN_URL ?? serviceAccessUrl,
    "asset-access": process.env.NEXT_PUBLIC_ASSET_ACCESS_URL ?? serviceAccessUrl,
    "service-workflow": process.env.NEXT_PUBLIC_SERVICE_WORKFLOW_URL ?? serviceAccessUrl,
    "certificate-field": process.env.NEXT_PUBLIC_CERTIFICATE_FIELD_URL ?? serviceAccessUrl,
    "offline-sync": process.env.NEXT_PUBLIC_OFFLINE_SYNC_URL ?? serviceAccessUrl,
    "service-access": serviceAccessUrl,
  }

  return {
    url,
    publishableKey,
    serviceAccessUrl,
    edgeFunctions,
  }
}
