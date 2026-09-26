import { describe, expect, it } from "vitest"

import { canHandleRoute, parseOperationsQuery, parseRoute, routeOwner } from "./route.ts"

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
    ["GET", ["operations"], "service-workflow"],
    ["GET", ["operations", "00000000-0000-0000-0000-000000000001"], "service-workflow"],
    ["POST", ["work-orders", "o-1", "certificate-draft"], "certificate-field"],
    ["POST", ["visits", "v-1", "signatures"], "certificate-field"],
    ["POST", ["visits", "v-1", "sync"], "offline-sync"],
    ["GET", ["offline", "working-set"], "offline-sync"],
  ])("assigns %s /%s to %s", (method, route, owner) => {
    expect(routeOwner(method, route)).toBe(owner)
  })

  it("keeps unsupported routes unassigned", () => {
    expect(routeOwner("DELETE", ["context"])).toBeNull()
    expect(routeOwner("DELETE", ["accounts", "a-1"])).toBe("identity-admin")
    expect(routeOwner("DELETE", ["valves", "v-1"])).toBeNull()
    expect(routeOwner("POST", ["operations"])).toBeNull()
    expect(routeOwner("PATCH", ["operations", "00000000-0000-0000-0000-000000000001"])).toBeNull()
    expect(routeOwner("POST", ["storage", "upload"])).toBeNull()
  })

  it("validates the operations query and normalizes optional search text", () => {
    const request = new Request(
      "https://example.supabase.co/functions/v1/service-workflow/operations?from=2026-09-01&to=2026-09-30&status=solicitada%2Ccompletada&workshop_id=00000000-0000-0000-0000-000000000001&client_id=00000000-0000-0000-0000-000000000002&q=%20valve%20&limit=25&offset=5",
    )
    expect(parseOperationsQuery(request)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      status: "solicitada,completada",
      workshopId: "00000000-0000-0000-0000-000000000001",
      clientId: "00000000-0000-0000-0000-000000000002",
      q: "valve",
      limit: 25,
      offset: 5,
    })
  })

  it.each([
    "from=2026-02-30",
    "from=2026-09-02&to=2026-09-01",
    "status=unknown",
    "status=pendiente",
    "workshop_id=not-a-uuid",
    "client_id=not-a-uuid",
    "to=2026-02-30",
    "limit=0",
    "limit=101",
    "offset=-1",
  ])("rejects invalid operations query: %s", (query) => {
    expect(() =>
      parseOperationsQuery(new Request(`https://example.test/operations?${query}`)),
    ).toThrow(/Invalid|must|unsupported|UUID|characters/)
  })

  it("allows the legacy gateway to fall back only to assigned routes", () => {
    expect(canHandleRoute("service-access", "GET", ["yacimientos"])).toBe(true)
    expect(canHandleRoute("service-access", "GET", ["context"])).toBe(true)
    expect(canHandleRoute("service-access", "POST", ["storage", "upload"])).toBe(false)
    expect(canHandleRoute("asset-access", "GET", ["requests"])).toBe(false)
  })
})
