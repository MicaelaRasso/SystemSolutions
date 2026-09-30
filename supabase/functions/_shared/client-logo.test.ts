import { describe, expect, it } from "vitest"

import {
  CLIENT_LOGO_MAX_BYTES,
  clientLogoObjectName,
  validateClientLogo,
} from "./client-logo.ts"

describe("Cliente logo validation", () => {
  it("accepts the supported image formats up to 2 MB", () => {
    for (const contentType of ["image/jpeg", "image/png", "image/svg+xml", "image/webp"])
      expect(validateClientLogo("clients/cliente/logo.png", contentType, CLIENT_LOGO_MAX_BYTES).ok)
        .toBe(true)
  })

  it.each([
    ["application/pdf", 20],
    ["image/png", CLIENT_LOGO_MAX_BYTES + 1],
    ["image/png", -1],
  ])("rejects invalid logo metadata (%s, %s bytes)", (contentType, size) => {
    expect(validateClientLogo("clients/cliente/logo.png", contentType, size).ok).toBe(false)
  })

  it("creates a safe, client-scoped object name", () => {
    const name = clientLogoObjectName("client-id", "my logo?.png")
    expect(name).toMatch(/^clients\/client-id\/[0-9a-f-]+-my-logo-.png$/)
  })
})
