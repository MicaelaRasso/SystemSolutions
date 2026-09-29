import { describe, expect, it } from "vitest"

import { authenticateRequest, bearerAuthorization } from "./auth.ts"

describe("shared authentication", () => {
  const env = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable",
  }

  it("accepts only bearer authorization headers", () => {
    expect(bearerAuthorization("Bearer token")).toBe("Bearer token")
    expect(bearerAuthorization("bearer token")).toBe("bearer token")
    expect(bearerAuthorization("Basic token")).toBeNull()
    expect(bearerAuthorization("Bearer")).toBeNull()
  })

  it("returns the authenticated actor from the JWT verifier", async () => {
    const request = new Request("https://example.test/functions/v1/asset-access/yacimientos", {
      headers: { authorization: "Bearer token" },
    })

    await expect(
      authenticateRequest(request, {
        env,
        getUser: async (authorization) => ({
          id: authorization === "Bearer token" ? "user-1" : "wrong",
        }),
      }),
    ).resolves.toEqual({ id: "user-1", authorization: "Bearer token" })
  })

  it("rejects missing or invalid JWTs", async () => {
    const request = new Request("https://example.test/functions/v1/asset-access/yacimientos")
    await expect(authenticateRequest(request, { env })).rejects.toMatchObject({ status: 401 })

    const invalidRequest = new Request(request.url, {
      headers: { authorization: "Bearer invalid" },
    })
    await expect(
      authenticateRequest(invalidRequest, { env, getUser: async () => null }),
    ).rejects.toMatchObject({ status: 401 })
  })
})
