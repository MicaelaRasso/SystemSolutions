import { describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { EdgeAccessClient } from "./edge"

describe("EdgeAccessClient", () => {
  it("sends business operations to service-access with the authenticated seam", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "plant-1", yacimiento_id: "yac-1", nombre: "Planta 1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    const client = new EdgeAccessClient({
      baseUrl: "https://example.supabase.co/functions/v1/service-access",
      anonKey: "anon-key",
      request,
    })

    await client.createDescendant("planta", "yac-1", "Planta 1")

    expect(request).toHaveBeenCalledWith(
      "https://example.supabase.co/functions/v1/service-access/hierarchy",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          apikey: "anon-key",
          "content-type": "application/json",
        }),
        body: JSON.stringify({ kind: "planta", parent_id: "yac-1", name: "Planta 1" }),
      }),
    )
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

  it("forwards the Auth cookie session token to service-access", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    })
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ cuenta_id: "account-1" }), { status: 200 }))
    const client = new EdgeAccessClient({
      baseUrl: "https://example.test",
      request,
      auth: () => ({ auth: { getSession } }) as never,
    })

    await client.context()

    expect(request).toHaveBeenCalledWith(
      "https://example.test/context",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer session-token" }),
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
})
