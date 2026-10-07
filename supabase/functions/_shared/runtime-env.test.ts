import { afterEach, describe, expect, it, vi } from "vitest"

import { runtimeEnv } from "./runtime-env.ts"

describe("runtimeEnv Supabase key compatibility", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("reads the injected secret-key JSON when the singular secret is absent", () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (name: string) => ({
          SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_project" }),
        })[name],
      },
    })

    expect(runtimeEnv()).toMatchObject({
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_project",
    })
  })

  it("prefers the legacy singular key when it is present", () => {
    vi.stubGlobal("Deno", {
      env: {
        get: (name: string) => ({
          SUPABASE_SECRET_KEY: "legacy_secret",
          SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_project" }),
        })[name],
      },
    })

    expect(runtimeEnv().SUPABASE_SECRET_KEY).toBe("legacy_secret")
  })
})
