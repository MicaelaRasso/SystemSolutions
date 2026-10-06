import { describe, expect, it, vi } from "vitest"

import type { EdgeAccessClient } from "../services/edge"
import { createCertificatesApi } from "./certificates"

const sourceId = "11111111-1111-4111-8111-111111116314"
const providerId = "22222222-2222-4222-8222-222222226305"

describe("certificate correction API", () => {
  it("sends a reason and a new visit window to the authorization command", async () => {
    const request = vi.fn().mockResolvedValue({ correction_id: sourceId })
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    await api.authorizeCorrection(sourceId, {
      providerId,
      startsAt: "2099-03-10T09:00:00Z",
      endsAt: "2099-03-10T10:00:00Z",
      reason: "  Recalibración  ",
    })

    expect(request).toHaveBeenCalledWith(
      `certificates/${sourceId}/corrections`,
      expect.anything(),
      {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId,
          starts_at: "2099-03-10T09:00:00Z",
          ends_at: "2099-03-10T10:00:00Z",
          reason: "Recalibración",
        }),
      },
    )
  })

  it("rejects a reversed visit window before calling Edge", async () => {
    const request = vi.fn()
    const api = createCertificatesApi({ request } as unknown as EdgeAccessClient)

    expect(() => api.authorizeCorrection(sourceId, {
      providerId,
      startsAt: "2099-03-10T10:00:00Z",
      endsAt: "2099-03-10T09:00:00Z",
      reason: "Recalibración",
    })).toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
