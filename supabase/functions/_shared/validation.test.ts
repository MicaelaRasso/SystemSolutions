import { describe, expect, it } from "vitest"

import { MAX_JSON_BODY_BYTES, parseJsonObject } from "./validation.ts"

describe("shared JSON request validation", () => {
  it("parses object bodies and rejects malformed or oversized bodies", async () => {
    await expect(
      parseJsonObject(new Request("https://example.test", { method: "POST", body: '{"ok":true}' })),
    ).resolves.toEqual({ ok: true })

    await expect(
      parseJsonObject(new Request("https://example.test", { method: "POST", body: "[]" })),
    ).rejects.toMatchObject({ status: 400 })

    await expect(
      parseJsonObject(
        new Request("https://example.test", {
          method: "POST",
          body: "{}",
          headers: { "content-length": String(MAX_JSON_BODY_BYTES + 1) },
        }),
      ),
    ).rejects.toMatchObject({ status: 413 })
  })
})
