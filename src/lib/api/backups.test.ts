import { describe, expect, it, vi } from "vitest"

import { createBackupsApi } from "./backups"

describe("backup capability client", () => {
  it("downloads the archive and parses integrity headers", async () => {
    const edge = {
      download: vi.fn().mockResolvedValue(
        new Response(new Blob(["zip"]), {
          headers: {
            "content-disposition": 'attachment; filename="backup.zip"',
            "x-backup-generation-id": "generation-1",
            "x-backup-sha256": "a".repeat(64),
            "x-backup-warnings": JSON.stringify(["media warning"]),
          },
        }),
      ),
    }
    const result = await createBackupsApi(edge as never).download({ scope: "complete" })

    expect(result.filename).toBe("backup.zip")
    expect(result.generationId).toBe("generation-1")
    expect(result.archiveSha256).toBe("a".repeat(64))
    expect(result.warnings).toEqual(["media warning"])
    expect(edge.download).toHaveBeenCalledWith("backups", expect.objectContaining({ method: "POST" }))
  })
})
