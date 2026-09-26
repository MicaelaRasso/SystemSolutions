import { describe, expect, it } from "vitest"

import { canHandleRoute, parseRoute, routeOwner } from "./route.ts"

describe("shared route ownership", () => {
  it("parses only the suffix after the deployed function name", () => {
    const request = new Request(
      "https://example.supabase.co/functions/v1/asset-access/yacimientos/y-1/tree",
    )
    expect(parseRoute(request, "asset-access")).toEqual(["yacimientos", "y-1", "tree"])
  })

  it.each([
    ["GET", ["context"], "identity-admin"],
    ["POST", ["yacimientos"], "asset-access"],
    ["PATCH", ["valves", "v-1"], "asset-access"],
    ["GET", ["requests"], "service-workflow"],
    ["POST", ["work-orders", "o-1", "certificate-draft"], "certificate-field"],
    ["POST", ["visits", "v-1", "signatures"], "certificate-field"],
    ["POST", ["visits", "v-1", "sync"], "offline-sync"],
    ["GET", ["offline", "working-set"], "offline-sync"],
  ])("assigns %s /%s to %s", (method, route, owner) => {
    expect(routeOwner(method, route)).toBe(owner)
  })

  it("does not assign unresolved policy routes", () => {
    expect(routeOwner("DELETE", ["context"])).toBeNull()
    expect(routeOwner("DELETE", ["accounts", "a-1"])).toBeNull()
    expect(routeOwner("DELETE", ["valves", "v-1"])).toBeNull()
    expect(routeOwner("POST", ["operations"])).toBeNull()
    expect(routeOwner("POST", ["storage", "upload"])).toBeNull()
  })

  it("allows the legacy gateway to fall back only to assigned routes", () => {
    expect(canHandleRoute("service-access", "GET", ["yacimientos"])).toBe(true)
    expect(canHandleRoute("service-access", "GET", ["context"])).toBe(true)
    expect(canHandleRoute("service-access", "POST", ["storage", "upload"])).toBe(false)
    expect(canHandleRoute("asset-access", "GET", ["requests"])).toBe(false)
  })
})
