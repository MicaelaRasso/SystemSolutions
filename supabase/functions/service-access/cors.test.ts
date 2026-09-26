import { describe, expect, it } from "vitest"

import { corsHeaders, isAllowedOrigin } from "./cors"

describe("service-access CORS", () => {
  it("does not enable CORS without an explicit allow-list", () => {
    expect(isAllowedOrigin("https://app.example.com", undefined)).toBe(false)
    expect(corsHeaders("https://app.example.com", undefined)).toEqual({})
  })

  it("reflects only an explicitly allow-listed origin", () => {
    const configuredOrigins = "https://app.example.com, http://localhost:3000"

    expect(corsHeaders("https://app.example.com", configuredOrigins)).toMatchObject({
      "access-control-allow-origin": "https://app.example.com",
      vary: "Origin",
    })
    expect(corsHeaders("https://untrusted.example.com", configuredOrigins)).toEqual({})
  })
})
