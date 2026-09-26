export type BackupMediaReference = {
  id: string
  bucket: string
  object_path: string
  categoria?: string | null
  expected_size?: number | null
  expected_updated_at?: string | null
}

export type BackupSnapshot = {
  generation: {
    id: string
    scope: "complete" | "date_range"
    from_date: string | null
    to_date: string | null
    business_timezone: string
    snapshot_at: string
  }
  records: Record<string, unknown[]>
  media: BackupMediaReference[]
  excluded: string[]
}

export type BackupArchive = {
  bytes: Uint8Array
  archiveSha256: string
  recordCount: number
  includedMediaCount: number
  warnings: string[]
}

export type BackupArchiveOptions = {
  downloadMedia: (reference: BackupMediaReference) => Promise<Uint8Array | { data: Uint8Array; updatedAt?: string | null }>
  maxArchiveBytes?: number
  maxDurationMs?: number
  now?: () => number
}

export const DEFAULT_MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
export const DEFAULT_MAX_DURATION_MS = 20_000

export class BackupLimitError extends Error {
  readonly code: "backup_size_limit" | "backup_time_limit"
  readonly status: 413 | 504

  constructor(code: "backup_size_limit" | "backup_time_limit", message: string) {
    super(message)
    this.name = "BackupLimitError"
    this.code = code
    this.status = code === "backup_size_limit" ? 413 : 504
  }
}

const encoder = new TextEncoder()

const asBytes = (value: string | Uint8Array) =>
  typeof value === "string" ? encoder.encode(value) : value

const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")

export const sha256 = async (value: string | Uint8Array) =>
  hex(await crypto.subtle.digest("SHA-256", asBytes(value)))

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array) => {
  let value = 0xffffffff
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

const u16 = (value: number) => {
  const bytes = new Uint8Array(2)
  new DataView(bytes.buffer).setUint16(0, value, true)
  return bytes
}

const u32 = (value: number) => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
  return bytes
}

const concat = (chunks: Uint8Array[]) => {
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

type ZipEntry = { path: string; data: Uint8Array; checksum: string }

export async function createZip(entries: { path: string; data: string | Uint8Array }[]) {
  const prepared: ZipEntry[] = []
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const path = encoder.encode(entry.path)
    const data = asBytes(entry.data)
    if (path.length > 0xffff || data.length > 0xffffffff || offset > 0xffffffff)
      throw new BackupLimitError("backup_size_limit", "El backup excede el límite del formato ZIP")
    const checksum = await sha256(data)
    const crc = crc32(data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(path.length),
      u16(0),
      path,
      data,
    ])
    localParts.push(local)
    centralParts.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(path.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        path,
      ]),
    )
    prepared.push({ path: entry.path, data, checksum })
    offset += local.length
  }

  const centralDirectory = concat(centralParts)
  const body = concat(localParts)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(prepared.length),
    u16(prepared.length),
    u32(centralDirectory.length),
    u32(body.length),
    u16(0),
  ])
  return { bytes: concat([body, centralDirectory, end]), entries: prepared }
}

const safePart = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120) || "unknown"

const mediaPath = (reference: BackupMediaReference) => {
  const extension = reference.object_path.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] ?? ".bin"
  return `media/${safePart(reference.categoria ?? "otros")}/${safePart(reference.id)}${extension.toLowerCase()}`
}

const jsonMember = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const timestampsDiffer = (expected: string, actual: string) => {
  const expectedTime = Date.parse(expected)
  const actualTime = Date.parse(actual)
  return Number.isNaN(expectedTime) || Number.isNaN(actualTime) || expectedTime !== actualTime
}

export async function buildBackupArchive(
  snapshot: BackupSnapshot,
  options: BackupArchiveOptions,
): Promise<BackupArchive> {
  const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS
  const startedAt = (options.now ?? Date.now)()
  const warnings: string[] = []
  const entries: { path: string; data: string | Uint8Array }[] = []
  const mediaManifest: Record<string, unknown>[] = []

  const ensureBudget = (estimatedBytes = 0) => {
    if ((options.now ?? Date.now)() - startedAt >= maxDurationMs)
      throw new BackupLimitError("backup_time_limit", "La generación superó el límite de tiempo de descarga inmediata")
    if (estimatedBytes > maxArchiveBytes)
      throw new BackupLimitError("backup_size_limit", "El backup supera el límite de descarga inmediata")
  }

  let recordCount = 0
  for (const [table, rows] of Object.entries(snapshot.records).sort(([a], [b]) => a.localeCompare(b))) {
    const data = jsonMember(rows)
    recordCount += rows.length
    entries.push({ path: `records/${safePart(table)}.json`, data })
    ensureBudget(entries.reduce((total, entry) => total + asBytes(entry.data).length, 0))
  }

  let includedMediaCount = 0
  for (const reference of snapshot.media) {
    ensureBudget()
    const archivePath = mediaPath(reference)
    try {
      const downloaded = await options.downloadMedia(reference)
      const data = downloaded instanceof Uint8Array ? downloaded : downloaded.data
      const changed =
        (reference.expected_size !== null &&
          reference.expected_size !== undefined &&
          reference.expected_size !== data.length) ||
        Boolean(
          reference.expected_updated_at &&
            !(downloaded instanceof Uint8Array) &&
            downloaded.updatedAt &&
            timestampsDiffer(reference.expected_updated_at, downloaded.updatedAt),
        )
      const checksum = await sha256(data)
      if (changed) {
        const warning = `La media ${reference.id} cambió después de la instantánea.`
        warnings.push(warning)
        mediaManifest.push({ ...reference, archive_path: archivePath, status: "changed", size: data.length, sha256: checksum, warning })
      } else {
        mediaManifest.push({ ...reference, archive_path: archivePath, status: "included", size: data.length, sha256: checksum })
      }
      entries.push({ path: archivePath, data })
      includedMediaCount += 1
    } catch (error) {
      const detail = error instanceof Error ? error.message : "no se pudo leer el archivo"
      const warning = `La media ${reference.id} no se pudo incluir: ${detail}`
      warnings.push(warning)
      mediaManifest.push({ ...reference, archive_path: archivePath, status: "unreadable", warning })
    }
    ensureBudget(entries.reduce((total, entry) => total + asBytes(entry.data).length, 0))
  }

  const manifest = {
    format_version: 1,
    generated_at: new Date((options.now ?? Date.now)()).toISOString(),
    generation_id: snapshot.generation.id,
    scope: snapshot.generation.scope,
    from_date: snapshot.generation.from_date,
    to_date: snapshot.generation.to_date,
    business_timezone: snapshot.generation.business_timezone,
    snapshot_at: snapshot.generation.snapshot_at,
    records: Object.fromEntries(Object.entries(snapshot.records).map(([table, rows]) => [table, rows.length])),
    record_count: recordCount,
    media: mediaManifest,
    media_count: includedMediaCount,
    warnings,
    excluded: snapshot.excluded,
    archive_sha256: null,
    member_sha256: Object.fromEntries(
      await Promise.all(entries.map(async (entry) => [entry.path, await sha256(entry.data)] as const)),
    ),
  }
  entries.push({ path: "manifest.json", data: jsonMember(manifest) })
  const archive = await createZip(entries)
  ensureBudget(archive.bytes.length)
  return {
    bytes: archive.bytes,
    archiveSha256: await sha256(archive.bytes),
    recordCount,
    includedMediaCount,
    warnings,
  }
}
