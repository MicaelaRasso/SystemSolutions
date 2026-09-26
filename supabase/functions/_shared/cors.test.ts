import { describe, expect, it } from "vitest"

import { corsHeaders, isAllowedOrigin } from "./cors.ts"

describe("shared CORS", () => {
  it("requires an explicit origin allow-list", () => {
    expect(isAllowedOrigin("https://app.example.com", undefined)).toBe(false)
    expect(corsHeaders("https://app.example.com", undefined)).toEqual({})
  })

  it("reflects only configured origins and allows correlation IDs", () => {
    const headers = corsHeaders("https://app.example.com", "https://app.example.com") as Record<
      string,
      string
    >
    expect(headers).toMatchObject({
      "access-control-allow-origin": "https://app.example.com",
      vary: "Origin",
    })
    expect(headers["access-control-allow-headers"]).toContain("x-correlation-id")
    expect(corsHeaders("https://untrusted.example.com", "https://app.example.com")).toEqual({})
  })
})
