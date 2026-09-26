import { describe, expect, it } from "vitest"

import { BackupLimitError, buildBackupArchive, createZip } from "./archive.ts"

const snapshot = {
  generation: {
    id: "generation-1",
    scope: "complete" as const,
    from_date: null,
    to_date: null,
    business_timezone: "America/Argentina/Buenos_Aires",
    snapshot_at: "2026-09-26T23:00:00.000Z",
  },
  records: { cuentas: [{ id: "account-1", rol: "super_administrador" }] },
  media: [],
  excluded: ["auth.users", "storage.objects"],
}

describe("backup archive", () => {
  it("writes a UTF-8 ZIP and includes member checksums in the manifest", async () => {
    const archive = await buildBackupArchive(snapshot, { downloadMedia: async () => new Uint8Array() })
    expect(new TextDecoder().decode(archive.bytes.slice(0, 4))).toBe("PK\x03\x04")
    expect(archive.archiveSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(archive.recordCount).toBe(1)

    const zip = await createZip([{ path: "á.txt", data: "contenido" }])
    expect(zip.entries[0].checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(zip.bytes.length).toBeGreaterThan(30)
  })

  it("keeps a readable warning when referenced media cannot be downloaded", async () => {
    const archive = await buildBackupArchive(
      {
        ...snapshot,
        media: [{ id: "image-1", bucket: "certificate-images", object_path: "missing.png" }],
      },
      { downloadMedia: async () => { throw new Error("object disappeared") } },
    )

    expect(archive.includedMediaCount).toBe(0)
    expect(archive.warnings[0]).toContain("image-1")
    expect(archive.warnings[0]).toContain("object disappeared")
  })

  it("reports changed media instead of silently treating it as complete", async () => {
    const archive = await buildBackupArchive(
      {
        ...snapshot,
        media: [{ id: "image-1", bucket: "certificate-images", object_path: "changed.png", expected_size: 2 }],
      },
      { downloadMedia: async () => new Uint8Array([1, 2, 3]) },
    )

    expect(archive.includedMediaCount).toBe(1)
    expect(archive.warnings[0]).toContain("cambió")
  })

  it("detects a changed file even when its byte count is unchanged", async () => {
    const archive = await buildBackupArchive(
      {
        ...snapshot,
        media: [{ id: "image-1", bucket: "certificate-images", object_path: "changed.png", expected_size: 3, expected_updated_at: "2026-09-26T22:00:00.000Z" }],
      },
      { downloadMedia: async () => ({ data: new Uint8Array([1, 2, 3]), updatedAt: "2026-09-26T23:00:00.000Z" }) },
    )

    expect(archive.warnings[0]).toContain("cambió")
  })

  it("fails before returning an archive when the immediate-download limit is exceeded", async () => {
    await expect(
      buildBackupArchive(snapshot, { downloadMedia: async () => new Uint8Array(), maxArchiveBytes: 10 }),
    ).rejects.toMatchObject<Partial<BackupLimitError>>({ code: "backup_size_limit", status: 413 })
  })

  it("fails clearly when the immediate-download time limit is exceeded", async () => {
    await expect(
      buildBackupArchive(snapshot, { downloadMedia: async () => new Uint8Array(), maxDurationMs: 0 }),
    ).rejects.toMatchObject<Partial<BackupLimitError>>({ code: "backup_time_limit", status: 504 })
  })
})
