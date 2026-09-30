import { safeObjectName, validateStorageObject } from "./storage.ts"

export const CLIENT_LOGO_MAX_BYTES = 2 * 1024 * 1024
export const CLIENT_LOGO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
] as const

export const clientLogoObjectName = (clientId: string, fileName: string) => {
  const safeName = fileName.replace(/[^A-Za-z0-9._-]/g, "-")
  return safeObjectName(`clients/${clientId}/${crypto.randomUUID()}-${safeName}`)
}

export const validateClientLogo = (objectName: unknown, contentType: unknown, size: unknown) =>
  validateStorageObject(
    { objectName, contentType, size },
    { allowedMimeTypes: CLIENT_LOGO_MIME_TYPES, maxBytes: CLIENT_LOGO_MAX_BYTES },
  )
