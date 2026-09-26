export type SupabaseConfig = {
  url: string
  publishableKey: string
  serviceAccessUrl: string
}

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

  return {
    url,
    publishableKey,
    serviceAccessUrl:
      process.env.NEXT_PUBLIC_SERVICE_ACCESS_URL ?? `${url.replace(/\/$/, "")}/functions/v1/service-access`,
  }
}
