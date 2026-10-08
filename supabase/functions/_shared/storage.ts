const SAFE_OBJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/
const MAX_OBJECT_NAME_LENGTH = 512

export const DEFAULT_STORAGE_MAX_BYTES = 10 * 1024 * 1024
export const DEFAULT_STORAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

export type StorageObjectMetadata = {
  objectName: string
  contentType: string
  size: number
}

export type StorageValidation =
  { ok: true; metadata: StorageObjectMetadata } | { ok: false; error: string }

export const safeObjectName = (value: unknown): string | null => {
  if (typeof value !== "string") return null

  const objectName = value.trim()
  const segments = objectName.split("/")
  if (
    objectName.length === 0 ||
    objectName.length > MAX_OBJECT_NAME_LENGTH ||
    !SAFE_OBJECT_NAME.test(objectName) ||
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")
  )
    return null

  return objectName
}

export const normalizedMimeType = (value: unknown): string | null => {
  if (typeof value !== "string") return null

  const mimeType = value.trim().toLowerCase()
  return /^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/.test(mimeType) ? mimeType : null
}

export const validateStorageObject = (
  input: { objectName: unknown; contentType: unknown; size: unknown },
  options: {
    maxBytes?: number
    allowedMimeTypes?: readonly string[]
  } = {},
): StorageValidation => {
  const objectName = safeObjectName(input.objectName)
  if (!objectName) return { ok: false, error: "Invalid storage object name" }

  const contentType = normalizedMimeType(input.contentType)
  const allowedMimeTypes = options.allowedMimeTypes ?? DEFAULT_STORAGE_MIME_TYPES
  if (!contentType || !allowedMimeTypes.includes(contentType))
    return { ok: false, error: "Unsupported storage content type" }

  const maxBytes = options.maxBytes ?? DEFAULT_STORAGE_MAX_BYTES
  const size = input.size
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 || size > maxBytes)
    return { ok: false, error: "Invalid storage object size" }

  return {
    ok: true,
    metadata: { objectName, contentType, size },
  }
}

export const storageMetadata = (metadata: StorageObjectMetadata): Record<string, string> => ({
  "content-type": metadata.contentType,
  "content-length": String(metadata.size),
})

export const uploadStorageObject = async (
  bucket: string,
  objectName: string,
  file: File,
): Promise<void> => {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = (await import("./runtime-env.ts")).runtimeEnv()
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase storage is not configured")
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
  const client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.storage.from(bucket).upload(objectName, file, {
    contentType: file.type,
    upsert: true,
  })
  if (error) throw error
}

export const removeStorageObject = async (bucket: string, objectName: string): Promise<void> => {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = (await import("./runtime-env.ts")).runtimeEnv()
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase storage is not configured")
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
  const client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.storage.from(bucket).remove([objectName])
  if (error) throw error
}

export const createSignedStorageUrl = async (
  bucket: string,
  objectName: string,
  expiresIn = 3600,
  download = false,
) => {
  const { SUPABASE_URL, SUPABASE_SECRET_KEY } = (await import("./runtime-env.ts")).runtimeEnv()
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) throw new Error("Supabase storage is not configured")
  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
  const client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await client.storage.from(bucket).createSignedUrl(objectName, expiresIn, {
    download,
  })
  if (error || !data?.signedUrl) throw error ?? new Error("Could not create a signed storage URL")
  return data.signedUrl
}
