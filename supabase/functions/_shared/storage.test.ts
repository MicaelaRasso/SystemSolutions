import { describe, expect, it } from "vitest"

import {
  DEFAULT_STORAGE_MAX_BYTES,
  safeObjectName,
  storageMetadata,
  validateStorageObject,
} from "./storage.ts"

describe("shared storage validation", () => {
  it("accepts relative object names and returns normalized metadata", () => {
    const result = validateStorageObject({
      objectName: "visits/visit-1/signature.png",
      contentType: "IMAGE/PNG",
      size: 128,
    })

    expect(result).toEqual({
      ok: true,
      metadata: {
        objectName: "visits/visit-1/signature.png",
        contentType: "image/png",
        size: 128,
      },
    })
    if (result.ok)
      expect(storageMetadata(result.metadata)).toEqual({
        "content-type": "image/png",
        "content-length": "128",
      })
  })

  it.each([
    "../secret.png",
    "visits/../secret.png",
    "/absolute.png",
    "visits//file.png",
    "visits\\file.png",
    "",
  ])("rejects unsafe object name %s", (objectName) => expect(safeObjectName(objectName)).toBeNull())

  it("rejects unsupported MIME types and oversized objects", () => {
    expect(
      validateStorageObject({ objectName: "file.svg", contentType: "image/svg+xml", size: 1 }),
    ).toEqual({ ok: false, error: "Unsupported storage content type" })
    expect(
      validateStorageObject({
        objectName: "file.png",
        contentType: "image/png",
        size: DEFAULT_STORAGE_MAX_BYTES + 1,
      }),
    ).toEqual({ ok: false, error: "Invalid storage object size" })
  })
})
