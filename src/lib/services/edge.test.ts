import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { EdgeAccessClient } from "./edge"

describe("EdgeAccessClient", () => {
  it.each([
    ["context", "identity-admin"],
    ["accounts", "identity-admin"],
    ["accounts/administrators", "identity-admin"],
    ["accounts/a-1/invitation/resend", "identity-admin"],
    ["account-security/email-change", "identity-admin"],
    ["yacimientos/y1/tree", "asset-access"],
    ["hierarchy", "asset-access"],
    ["valves/v1", "asset-access"],
    ["valves/v1/certificates", "certificate-field"],
    ["clients/me/pending-certificates", "certificate-field"],
    ["requests/r1/schedule", "service-workflow"],
    ["visits/v1", "service-workflow"],
    ["visits/v1/sync", "offline-sync"],
    ["work-orders/w1", "service-workflow"],
    ["work-orders/w1/certificate-draft", "certificate-field"],
    ["certificates/c1", "certificate-field"],
    ["operations?from=2026-01-01", "service-workflow"],
    ["offline/working-set", "offline-sync"],
  ] as const)("routes %s to %s", (path, owner) => {
    const client = new EdgeAccessClient({ baseUrl: "https://example.test" })
    expect(client.functionForPath(path)).toBe(owner)
  })

  it("fails unknown paths locally", () => {
    const client = new EdgeAccessClient({ baseUrl: "https://example.test" })
    expect(() => client.functionForPath("unowned-resource")).toThrow("Ruta Edge sin propietario")
  })

  it("sends hierarchy writes directly to asset-access", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "plant-1", yacimiento_id: "yac-1", nombre: "Planta 1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const client = new EdgeAccessClient({
      baseUrl: "https://example.supabase.co",
      publishableKey: "publishable-key",
      request,
    })

    await client.createDescendant("planta", "yac-1", "Planta 1")

    expect(request).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/asset-access/hierarchy",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "publishable-key",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ kind: "planta", parent_id: "yac-1", name: "Planta 1" }),
      }),
    )
  })

  it("selects a named function URL without changing the route contract", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            cuenta_id: "account-1",
            rol: "administrador_regular",
            taller_movil_id: null,
            cliente: false,
            estado: "activa",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      functionUrls: {
        "identity-admin": "https://identity.test/identity-admin",
        "asset-access": "https://assets.test/asset-access",
      },
      request,
    })

    await client.context()
    await client.listYacimientos()

    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://identity.test/identity-admin/context",
      expect.anything(),
    )
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://assets.test/asset-access/yacimientos",
      expect.anything(),
    )
  })

  it("routes certificate history to certificate-field", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ certificates: [] }), { status: 200 }))
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      functionUrls: { "certificate-field": "https://certificates.test/certificate-field" },
      request,
    })

    await client.certificatesForValve("valve-1")

    expect(request).toHaveBeenCalledWith(
      "https://certificates.test/certificate-field/valves/valve-1/certificates",
      expect.anything(),
    )
  })

  it("routes certificate draft creation to certificate-field", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ certificate: {} }), { status: 200 }))
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      functionUrls: { "certificate-field": "https://certificates.test/certificate-field" },
      request,
    })

    await client.request(
      "work-orders/order-1/certificate-draft",
      z.object({ certificate: z.object({}) }),
      {
        method: "POST",
        body: "{}",
      },
    )

    expect(request).toHaveBeenCalledWith(
      "https://certificates.test/certificate-field/work-orders/order-1/certificate-draft",
      expect.anything(),
    )
  })

  it("unwraps the table-shaped context returned by PostgreSQL", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            cuenta_id: "account-1",
            rol: "administrador_regular",
            taller_movil_id: null,
            cliente: false,
            estado: "activa",
          },
        ]),
        { status: 200 },
      ),
    )
    const client = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(client.context()).resolves.toMatchObject({ cuenta_id: "account-1" })
  })

  it("translates Edge Function authorization failures into ServiceError", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 }),
      )
    const client = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(client.context()).rejects.toMatchObject({
      message: "Authentication required",
      code: "unauthorized",
    })
  })

  it("validates successful responses against the supplied schema", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: "account-1" }), { status: 200 }))
    const client = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(client.request("context", z.object({ id: z.string() }))).resolves.toEqual({
      id: "account-1",
    })
  })

  it("rejects malformed successful responses as network errors", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ id: 42 }), { status: 200 }))
    const client = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(client.request("context", z.object({ id: z.string() }))).rejects.toMatchObject({
      code: "network",
    })
  })

  it.each([
    [403, "unauthorized"],
    [404, "not_found"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ error: "Request rejected" }), { status }))
    const client = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(client.request("context", z.object({ id: z.string() }))).rejects.toMatchObject({
      code,
    })
  })

  it("maps thrown fetch errors to network errors", async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error("Connection failed"))
    const client = new EdgeAccessClient({ baseUrl: "https://example.test", request })

    await expect(client.request("context", z.object({ id: z.string() }))).rejects.toMatchObject({
      message: "Connection failed",
      code: "network",
    })
  })

  it("forwards the Auth token, apikey, and correlation ID to the selected function", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    })
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          cuenta_id: "account-1",
          rol: "administrador_regular",
          taller_movil_id: null,
          cliente: false,
          estado: "activa",
        }),
        { status: 200 },
      ),
    )
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      publishableKey: "publishable-key",
      correlationId: "correlation-1",
      request,
      auth: () => ({ auth: { getSession } }) as never,
    })

    await client.context()

    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/identity-admin/context",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
      }),
    )
    expect(request).toHaveBeenCalledWith(
      "https://example.test/functions/v1/identity-admin/context",
      expect.objectContaining({
        headers: expect.objectContaining({
          apikey: "publishable-key",
          "x-correlation-id": "correlation-1",
        }),
      }),
    )
  })

  it("signs in through the Supabase Auth browser client before loading context", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: { access_token: "session-token" },
        user: {
          email: "user@example.test",
          user_metadata: { nombre: "Ada", apellido: "Lovelace" },
        },
      },
      error: null,
    })
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          cuenta_id: "account-1",
          rol: "administrador_regular",
          taller_movil_id: null,
          cliente: false,
          estado: "activa",
        }),
        { status: 200 },
      ),
    )
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      request,
      auth: () =>
        ({
          auth: {
            signInWithPassword,
            getSession: vi.fn().mockResolvedValue({
              data: { session: { access_token: "session-token" } },
              error: null,
            }),
          },
        }) as never,
    })

    await expect(client.login(" USER@example.test ", "password")).resolves.toMatchObject({
      id: "account-1",
      email: "user@example.test",
      rol: "admin",
    })
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "USER@example.test",
      password: "password",
    })
  })

  it("derives the application account and role from Edge context, not the Auth user id", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: "session-token",
          user: { id: "supabase-auth-user", email: "user@example.test", user_metadata: {} },
        },
      },
      error: null,
    })
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      request: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            cuenta_id: "application-account",
            rol: "taller_movil",
            taller_movil_id: "workshop-1",
            cliente: false,
            estado: "activa",
          }),
          { status: 200 },
        ),
      ),
      auth: () => ({ auth: { getSession } }) as never,
    })

    await expect(client.authenticatedUser()).resolves.toMatchObject({
      id: "application-account",
      rol: "taller",
      tallerId: "workshop-1",
    })
  })

  it("rejects an account context that is not active", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "session-token", user: { id: "pending-account" } } },
      error: null,
    })
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      request: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            cuenta_id: "pending-account",
            rol: "cliente",
            taller_movil_id: null,
            cliente: true,
            estado: "pendiente",
          }),
          { status: 200 },
        ),
      ),
      auth: () => ({ auth: { getSession } }) as never,
    })

    await expect(client.authenticatedUser()).rejects.toMatchObject({ code: "unauthorized" })
  })
})
