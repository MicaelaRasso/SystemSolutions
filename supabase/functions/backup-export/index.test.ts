import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import type { RouteHandler } from "../_shared/transport.ts"

const generation = {
  id: "00000000-0000-0000-0000-000000000001",
  scope: "date_range" as const,
  from_date: "2026-09-01",
  to_date: "2026-09-30",
  business_timezone: "America/Argentina/Buenos_Aires",
  snapshot_at: "2026-09-26T23:00:00.000Z",
}

const makeContext = (body: Record<string, unknown>, rpc: ReturnType<typeof vi.fn>) => ({
  request: new Request("https://example.test/functions/v1/backup-export/backups"),
  route: ["backups"],
  body,
  actor: { id: "account-1", authorization: "Bearer token" },
  db: { rpc } as never,
  correlationId: "correlation-1",
  metadata: {} as never,
})

let createBackupExportHandler: (dependencies?: {
  downloadMedia?: (reference: { bucket: string; object_path: string }) => Promise<Uint8Array>
  maxArchiveBytes?: number
}) => RouteHandler

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: vi.fn(), env: { get: vi.fn() } })
  ;({ createBackupExportHandler } = await import("./index.ts"))
})

afterAll(() => vi.unstubAllGlobals())

describe("backup-export handler", () => {
  it("creates a new generation, returns a ZIP, and records its checksum", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        data: { generation, records: { visits: [{ id: "visit-1" }] }, media: [], excluded: [] },
        error: null,
      })
      .mockResolvedValueOnce({ data: {}, error: null })
    const handler = createBackupExportHandler({ downloadMedia: async () => new Uint8Array() })

    const response = await handler(makeContext({ scope: "date_range", from: generation.from_date, to: generation.to_date }, rpc))

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("application/zip")
    expect(response.headers.get("x-backup-generation-id")).toBe(generation.id)
    expect(rpc).toHaveBeenNthCalledWith(1, "api_prepare_backup_export", {
      export_scope: "date_range",
      from_date: generation.from_date,
      to_date: generation.to_date,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, "api_record_backup_export_result", expect.objectContaining({
      generation_id: generation.id,
      export_status: "success",
      archive_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
  })

  it("records a warning outcome when a referenced file is unreadable", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { generation, records: {}, media: [{ id: "image-1", bucket: "b", object_path: "x.png" }], excluded: [] }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
    const response = await createBackupExportHandler({ downloadMedia: async () => { throw new Error("missing") } })(makeContext({ scope: "date_range", from: generation.from_date, to: generation.to_date }, rpc))

    expect(response.status).toBe(200)
    expect(response.headers.get("x-backup-warnings")).toContain("image-1")
    expect(rpc).toHaveBeenNthCalledWith(2, "api_record_backup_export_result", expect.objectContaining({ export_status: "warning" }))
  })

  it("records a failed attempt and returns a clear limit error", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { generation: { ...generation, scope: "complete", from_date: null, to_date: null }, records: { large: [{ value: "large" }] }, media: [], excluded: [] }, error: null })
      .mockResolvedValueOnce({ data: {}, error: null })
    const handler = createBackupExportHandler({ downloadMedia: async () => new Uint8Array(), maxArchiveBytes: 10 })

    await expect(handler(makeContext({ scope: "complete" }, rpc))).rejects.toMatchObject({ status: 413 })
    expect(rpc).toHaveBeenNthCalledWith(2, "api_record_backup_export_result", expect.objectContaining({ export_status: "failure", error_code: "backup_size_limit" }))
  })

  it("rejects an invalid range before creating a generation attempt", async () => {
    const rpc = vi.fn()
    await expect(createBackupExportHandler()(makeContext({ scope: "date_range", from: "2026-09-30", to: "2026-09-01" }, rpc))).rejects.toMatchObject({ status: 400 })
    expect(rpc).not.toHaveBeenCalled()
  })
})
