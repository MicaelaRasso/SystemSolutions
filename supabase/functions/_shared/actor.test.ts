import { describe, expect, it } from "vitest"

import { actorHeaders } from "./actor.ts"

describe("actor propagation headers", () => {
  it("carries the actor, correlation, and owning function", () => {
    expect(
      actorHeaders({ actorId: "user-1", correlationId: "request-1", functionName: "asset-access" }),
    ).toEqual({
      "x-systemsolutions-actor-id": "user-1",
      "x-systemsolutions-correlation-id": "request-1",
      "x-systemsolutions-function": "asset-access",
    })
  })
})
