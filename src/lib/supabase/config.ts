export type SupabaseConfig = {
  url: string
  publishableKey: string
  edgeFunctions: Record<EdgeFunctionName, string>
}

export const edgeFunctionNames = [
  "identity-admin",
  "asset-access",
  "service-workflow",
  "certificate-field",
  "offline-sync",
  "backup-export",
] as const

export type EdgeFunctionName = (typeof edgeFunctionNames)[number]

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

  const edgeFunctions: Record<EdgeFunctionName, string> = {
    "identity-admin":
      process.env.NEXT_PUBLIC_IDENTITY_ADMIN_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/identity-admin`,
    "asset-access":
      process.env.NEXT_PUBLIC_ASSET_ACCESS_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/asset-access`,
    "service-workflow":
      process.env.NEXT_PUBLIC_SERVICE_WORKFLOW_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/service-workflow`,
    "certificate-field":
      process.env.NEXT_PUBLIC_CERTIFICATE_FIELD_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/certificate-field`,
    "offline-sync":
      process.env.NEXT_PUBLIC_OFFLINE_SYNC_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/offline-sync`,
    "backup-export":
      process.env.NEXT_PUBLIC_BACKUP_EXPORT_URL ??
      `${url.replace(/\/$/, "")}/functions/v1/backup-export`,
  }

  return {
    url,
    publishableKey,
    edgeFunctions,
  }
}
