import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { createSyncConflictsApi, workshopConflictOutcomesSchema } from "./sync-conflicts"

describe("sync conflict outcomes API", () => {
  it("shows administrative decisions to the Taller Móvil through the offline Edge Function", async () => {
    const result = {
      items: [{
        conflict_id: "00000000-0000-4000-8000-000000000001",
        operation_id: "00000000-0000-4000-8000-000000000002",
        visit_id: "00000000-0000-4000-8000-000000000003",
        operation_kind: "update_certificate_draft",
        resolution_action: "rejected",
        resolution_reason: "El certificado ya estaba firmado",
        resolved_at: "2026-10-06T13:00:00Z",
        result: { resolution: "rejected" },
      }],
    }
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(result), { status: 200 }),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    const parsed = workshopConflictOutcomesSchema.safeParse(result)
    if (!parsed.success) throw new Error(parsed.error.message)
    await expect(createSyncConflictsApi(edge).workshopOutcomes()).resolves.toEqual(result)
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/offline-sync/offline/conflict-outcomes",
      expect.objectContaining({ headers: expect.any(Object) }),
    )
  })

  it("sends an explicit decision and mandatory reason on the offline Edge Function", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ resolution: "rejected" }), { status: 200 }),
    )
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await createSyncConflictsApi(edge).resolve("00000000-0000-4000-8000-000000000001", {
      action: "reject",
      reason: "El certificado ya estaba firmado",
    })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/offline-sync/conflicts/00000000-0000-4000-8000-000000000001/resolve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "reject", reason: "El certificado ya estaba firmado" }),
      }),
    )
  })
})
