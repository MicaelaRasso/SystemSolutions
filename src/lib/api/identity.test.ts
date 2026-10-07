import { describe, expect, it, vi } from "vitest"

import { EdgeAccessClient } from "../services/edge"
import { createIdentityApi } from "./identity"

const administrator = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "admin@example.test",
  nombre: "Ana",
  apellido: "Admin",
  rol: "administrador_regular",
  activo: true,
  estado: "activa",
  creado_en: "2026-10-06T00:00:00Z",
}

describe("identity administrator API", () => {
  it("lists, creates, and changes administrator account state through identity-admin", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([administrator])))
      .mockResolvedValueOnce(new Response(JSON.stringify(administrator)))
      .mockResolvedValueOnce(new Response(JSON.stringify(administrator)))
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })
    const api = createIdentityApi(edge)

    await expect(api.administrators.list()).resolves.toEqual([administrator])
    await expect(api.administrators.create({
      email: administrator.email,
      nombre: administrator.nombre,
      apellido: administrator.apellido,
      rol: "administrador_regular",
    })).resolves.toEqual(administrator)
    await expect(api.administrators.setActive(administrator.id, false)).resolves.toEqual(administrator)

    expect(request).toHaveBeenNthCalledWith(1,
      "https://example.test/functions/v1/identity-admin/accounts/administrators",
      expect.any(Object),
    )
    expect(request).toHaveBeenNthCalledWith(2,
      "https://example.test/functions/v1/identity-admin/accounts/administrators",
      expect.objectContaining({ method: "POST", body: JSON.stringify({
        email: administrator.email,
        nombre: administrator.nombre,
        apellido: administrator.apellido,
        rol: "administrador_regular",
      }) }),
    )
    expect(request).toHaveBeenNthCalledWith(3,
      `https://example.test/functions/v1/identity-admin/accounts/administrators/${administrator.id}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ activo: false }) }),
    )
  })

  it("requests owner password recovery without revealing account lookup results", async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null })
    const auth = () => ({ auth: { resetPasswordForEmail } }) as never
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test" })
    const api = createIdentityApi(edge, auth)

    await expect(api.requestPasswordReset(" owner@example.test ", "https://example.test/reset"))
      .resolves.toEqual({ requested: true })
    expect(resetPasswordForEmail).toHaveBeenCalledWith("owner@example.test", {
      redirectTo: "https://example.test/reset",
    })
  })

  it("starts email changes through the signed-in Supabase Auth client", async () => {
    const updateUser = vi.fn().mockResolvedValue({ error: null })
    const auth = () => ({ auth: { updateUser } }) as never
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify("event-id")))
    const edge = new EdgeAccessClient({ baseUrl: "https://example.test", request })
    const api = createIdentityApi(edge, auth)

    await expect(api.requestEmailChange(" new@example.test "))
      .resolves.toEqual({ verificationRequired: true })
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/identity-admin/account-security/email-change",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ email: "new@example.test" }) }),
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(updateUser).toHaveBeenCalledWith({ email: "new@example.test" })
    expect(request.mock.invocationCallOrder[0]).toBeLessThan(updateUser.mock.invocationCallOrder[0])
  })
})
