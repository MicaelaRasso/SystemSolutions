import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const auth = vi.hoisted(() => ({
  claims: undefined as Record<string, unknown> | undefined,
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () =>
        auth.claims ? { data: { claims: auth.claims }, error: null } : { data: null, error: new Error("sin sesión") },
      getSession: async () => ({ data: { session: { access_token: "token" } }, error: null }),
    },
  }),
}))

import { CONTEXT_CACHE_COOKIE } from "@/lib/auth/context-cache"

import { updateSupabaseSession } from "./proxy"

const contexto = (cuenta_id: string) => ({
  cuenta_id,
  rol: "administrador_regular",
  taller_movil_id: null,
  cliente: false,
  estado: "activa",
})

function pedido(cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([nombre, valor]) => `${nombre}=${valor}`)
    .join("; ")
  return new NextRequest("http://localhost/admin/clientes", { headers: cookie ? { cookie } : {} })
}

describe("updateSupabaseSession con caché del rol", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proyecto.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "clave-publica")
    vi.stubEnv("OFFLINE_SESSION_SECRET", "s".repeat(40))
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => Response.json(contexto("cuenta-1")))
    auth.claims = { sub: "cuenta-1", session_id: "sesion-1", exp: Math.floor(Date.now() / 1_000) + 3_600 }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("sin caché consulta /context una vez, guarda la cookie y se la pasa a los Server Components", async () => {
    const request = pedido()
    const { response, sesion } = await updateSupabaseSession(request)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/identity-admin\/context$/)
    expect(sesion?.rol).toBe("admin")
    const cookie = response.cookies.get(CONTEXT_CACHE_COOKIE)
    expect(cookie?.value).toBeTruthy()
    expect(cookie?.httpOnly).toBe(true)
    expect(request.cookies.get(CONTEXT_CACHE_COOKIE)?.value).toBe(cookie?.value)
  })

  it("con caché válida de la misma sesión no llama a /context", async () => {
    const primera = await updateSupabaseSession(pedido())
    const valor = primera.response.cookies.get(CONTEXT_CACHE_COOKIE)!.value
    fetchMock.mockClear()

    const { sesion } = await updateSupabaseSession(pedido({ [CONTEXT_CACHE_COOKIE]: valor }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sesion).toMatchObject({ usuarioId: "cuenta-1", rol: "admin" })
  })

  it("si el JWT es de otro sujeto ignora la caché y vuelve a consultar", async () => {
    const primera = await updateSupabaseSession(pedido())
    const valor = primera.response.cookies.get(CONTEXT_CACHE_COOKIE)!.value
    fetchMock.mockClear()
    auth.claims = { ...auth.claims, sub: "cuenta-2" }
    fetchMock.mockImplementation(async () => Response.json(contexto("cuenta-2")))

    const { sesion } = await updateSupabaseSession(pedido({ [CONTEXT_CACHE_COOKIE]: valor }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sesion?.usuarioId).toBe("cuenta-2")
  })

  it("si /context deniega, borra la caché", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 403 }))

    const { response, sesion } = await updateSupabaseSession(
      pedido({ [CONTEXT_CACHE_COOKIE]: "vencida.firma" }),
    )

    expect(sesion).toBeNull()
    expect(response.cookies.get(CONTEXT_CACHE_COOKIE)?.value).toBe("")
  })

  it("sin sesión de Supabase borra la caché y no llama a /context", async () => {
    auth.claims = undefined

    const { response, sesion } = await updateSupabaseSession(
      pedido({ [CONTEXT_CACHE_COOKIE]: "cualquier.valor" }),
    )

    expect(sesion).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.cookies.get(CONTEXT_CACHE_COOKIE)?.value).toBe("")
  })
})
