import { describe, expect, it } from "vitest"

import { correlationId } from "./correlation.ts"

describe("correlation IDs", () => {
  it("preserves a safe caller correlation ID", () => {
    expect(correlationId(new Headers({ "x-correlation-id": "trace-1" }))).toBe("trace-1")
  })

  it("replaces unsafe or absent IDs with generated IDs", () => {
    expect(correlationId(new Headers({ "x-correlation-id": "bad value" }))).toMatch(
      /^[0-9a-f-]{36}$/,
    )
    expect(correlationId(new Headers())).toMatch(/^[0-9a-f-]{36}$/)
  })
})
