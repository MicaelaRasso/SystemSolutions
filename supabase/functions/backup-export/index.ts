import { HttpError } from "../_shared/errors.ts"
import { runtimeEnv } from "../_shared/runtime-env.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"
import { BackupLimitError, buildBackupArchive, type BackupSnapshot } from "./archive.ts"

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MAX_WARNING_HEADER_BYTES = 6_000

const isDate = (value: unknown): value is string => {
  if (typeof value !== "string") return false
  const match = DATE.exec(value)
  if (!match) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const invalid = (message: string): never => {
  throw new HttpError(400, message)
}

const input = (body: Record<string, unknown>) => {
  const scope = body.scope
  if (scope !== "complete" && scope !== "date_range") invalid("scope must be complete or date_range")
  if (scope === "complete") return { scope, from: null, to: null } as const
  const from = body.from
  const to = body.to
  if (!isDate(from) || !isDate(to)) invalid("from and to must be valid dates in YYYY-MM-DD format")
  if (from > to) invalid("from must be before or equal to to")
  return { scope, from, to } as const
}

const snapshotShape = (value: unknown): value is BackupSnapshot => {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<BackupSnapshot>
  return Boolean(
    candidate.generation &&
      typeof candidate.generation.id === "string" &&
      (candidate.generation.scope === "complete" || candidate.generation.scope === "date_range") &&
      typeof candidate.generation.business_timezone === "string" &&
      typeof candidate.generation.snapshot_at === "string" &&
      candidate.records &&
      typeof candidate.records === "object" &&
      !Array.isArray(candidate.records) &&
      Object.values(candidate.records).every((rows) => Array.isArray(rows)) &&
      Array.isArray(candidate.media) &&
      Array.isArray(candidate.excluded),
  )
}

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(runtimeEnv()[name as "BACKUP_MAX_ARCHIVE_BYTES"])
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

const storageDownloader = async () => {
  const env = runtimeEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    throw new HttpError(500, "Supabase storage is not configured")
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return async (reference: { bucket: string; object_path: string }) => {
    const { data, error } = await client.storage.from(reference.bucket).download(reference.object_path)
    if (error || !data) throw error ?? new Error("Storage returned no data")
    const slash = reference.object_path.lastIndexOf("/")
    const prefix = slash >= 0 ? reference.object_path.slice(0, slash + 1) : ""
    const name = slash >= 0 ? reference.object_path.slice(slash + 1) : reference.object_path
    const listed = await client.storage.from(reference.bucket).list(prefix, { limit: 100, search: name })
    const listedObject = listed.data?.find((item: { name?: string }) => item.name === name)
    return { data: new Uint8Array(await data.arrayBuffer()), updatedAt: listedObject?.updated_at ?? null }
  }
}

const recordResult = async (
  db: { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }> },
  generationId: string,
  result: {
    status: "success" | "warning" | "failure"
    recordCount?: number
    mediaCount?: number
    archiveSize?: number
    archiveSha256?: string | null
    warnings?: unknown[]
    errorCode?: string | null
    errorMessage?: string | null
  },
) =>
  db.rpc("api_record_backup_export_result", {
    generation_id: generationId,
    export_status: result.status,
    record_count: result.recordCount ?? 0,
    media_count: result.mediaCount ?? 0,
    archive_size_bytes: result.archiveSize ?? null,
    archive_sha256: result.archiveSha256 ?? null,
    warnings: result.warnings ?? [],
    error_code: result.errorCode ?? null,
    error_message: result.errorMessage ?? null,
  })

export type BackupExportDependencies = {
  downloadMedia?: (reference: { bucket: string; object_path: string }) => Promise<Uint8Array | { data: Uint8Array; updatedAt?: string | null }>
  maxArchiveBytes?: number
  maxDurationMs?: number
}

export const createBackupExportHandler = (
  dependencies: BackupExportDependencies = {},
): RouteHandler => async ({ body, db }) => {
  const request = input(body)
  const prepared = await db.rpc("api_prepare_backup_export", {
    export_scope: request.scope,
    from_date: request.from,
    to_date: request.to,
  })
  if (prepared.error) return prepared
  if (!snapshotShape(prepared.data)) throw new HttpError(502, "La instantánea del backup es inválida")

  const snapshot = prepared.data
  try {
    const archive = await buildBackupArchive(snapshot, {
      downloadMedia: dependencies.downloadMedia ?? (await storageDownloader()),
      maxArchiveBytes:
        dependencies.maxArchiveBytes ?? numberFromEnv("BACKUP_MAX_ARCHIVE_BYTES", 50 * 1024 * 1024),
      maxDurationMs: dependencies.maxDurationMs ?? numberFromEnv("BACKUP_MAX_DURATION_MS", 20_000),
    })
    const completed = await recordResult(db, snapshot.generation.id, {
      status: archive.warnings.length > 0 ? "warning" : "success",
      recordCount: archive.recordCount,
      mediaCount: archive.includedMediaCount,
      archiveSize: archive.bytes.length,
      archiveSha256: archive.archiveSha256,
      warnings: archive.warnings,
    })
    if (completed.error) throw new HttpError(500, "No se pudo registrar el resultado del backup")

    const filename =
      snapshot.generation.scope === "complete"
        ? "system-solutions-backup-completo.zip"
        : `system-solutions-backup-${snapshot.generation.from_date}-${snapshot.generation.to_date}.zip`
    const warningHeader = JSON.stringify(archive.warnings).slice(0, MAX_WARNING_HEADER_BYTES)
    return new Response(archive.bytes, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-backup-generation-id": snapshot.generation.id,
        "x-backup-sha256": archive.archiveSha256,
        "x-backup-warnings": warningHeader,
      },
    })
  } catch (error) {
    const code = error instanceof BackupLimitError ? error.code : "backup_generation_failed"
    const message = error instanceof Error ? error.message : "No se pudo generar el backup"
    const failed = await recordResult(db, snapshot.generation.id, {
      status: "failure",
      errorCode: code,
      errorMessage: message,
    })
    if (failed.error) console.error("backup_result_record_failed", failed.error)
    if (error instanceof BackupLimitError) throw new HttpError(error.status, message)
    throw error
  }
}

export const backupExportHandler = createBackupExportHandler()

serveFunction("backup-export", async (context) => {
  if (context.route.length !== 1 || context.route[0] !== "backups")
    return new Response(JSON.stringify({ error: "Route not found" }), { status: 404 })
  return backupExportHandler(context)
})
