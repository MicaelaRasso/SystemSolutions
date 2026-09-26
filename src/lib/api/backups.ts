import type { EdgeAccessClient } from "../services/edge"

export type BackupExportScope = "complete" | "date_range"

export type BackupExportInput =
  | { scope: "complete" }
  | { scope: "date_range"; from: string; to: string }

export type BackupDownload = {
  blob: Blob
  filename: string
  generationId: string | null
  archiveSha256: string | null
  warnings: string[]
}

function header(response: Response, name: string) {
  return response.headers.get(name)?.trim() || null
}

function filename(response: Response, fallback: string) {
  const disposition = header(response, "content-disposition")
  const match = disposition?.match(/filename="([^"]+)"/i)
  return match?.[1] ?? fallback
}

function warnings(response: Response) {
  const raw = header(response, "x-backup-warnings")
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
  } catch {
    return ["El servidor informó advertencias no legibles."]
  }
}

export function createBackupsApi(edge: EdgeAccessClient) {
  return {
    async download(input: BackupExportInput): Promise<BackupDownload> {
      const response = await edge.download("backups", {
        method: "POST",
        body: JSON.stringify({
          scope: input.scope,
          from: input.scope === "date_range" ? input.from : undefined,
          to: input.scope === "date_range" ? input.to : undefined,
        }),
      })
      const blob = await response.blob()
      return {
        blob,
        filename: filename(
          response,
          input.scope === "complete"
            ? "system-solutions-backup-completo.zip"
            : `system-solutions-backup-${input.from}-${input.to}.zip`,
        ),
        generationId: header(response, "x-backup-generation-id"),
        archiveSha256: header(response, "x-backup-sha256"),
        warnings: warnings(response),
      }
    },
  }
}

export type BackupsApi = ReturnType<typeof createBackupsApi>
