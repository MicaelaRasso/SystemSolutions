import { describe, expect, it } from "vitest"

import { errorStatus } from "./errors.ts"

describe("shared database error statuses", () => {
  it.each([
    ["insufficient_privilege", 403],
    ["42501", 403],
    ["PGRST116", 404],
    ["P0002", 404],
    ["02000", 404],
    ["23P01", 409],
    ["check_violation", 409],
    ["23514", 409],
    ["invalid_parameter_value", 400],
    ["foreign_key_violation", 400],
    ["23503", 400],
    ["other", 500],
  ])("maps %s to HTTP %s", (code, expected) => {
    expect(errorStatus({ code })).toBe(expected)
  })
})
