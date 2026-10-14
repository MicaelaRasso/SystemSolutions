import { createHmac } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  CONTEXT_CACHE_TTL_SECONDS,
  issueContextCache,
  verifyContextCache,
} from "./context-cache"

const SECRET = "s".repeat(40)
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)
const identidad = { sub: "cuenta-1", sid: "sesion-1" }

function reemplazarPayload(valor: string, cambios: Record<string, unknown>) {
  const [payload, firma] = valor.split(".")
  const datos = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  return `${Buffer.from(JSON.stringify({ ...datos, ...cambios })).toString("base64url")}.${firma}`
}

describe("caché firmada del contexto de autorización", () => {
  beforeEach(() => vi.stubEnv("OFFLINE_SESSION_SECRET", SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it("devuelve el rol cuando la cookie es válida y pertenece al mismo sujeto y sesión", () => {
    const valor = issueContextCache({ ...identidad, rol: "admin" }, NOW)
    expect(valor).toBeTypeOf("string")
    expect(verifyContextCache(valor, identidad, NOW + 60_000)).toBe("admin")
  })

  it("no hay acierto sin cookie", () => {
    expect(verifyContextCache(undefined, identidad, NOW)).toBeUndefined()
    expect(verifyContextCache("", identidad, NOW)).toBeUndefined()
  })

  it("rechaza una cookie de otro sujeto", () => {
    const valor = issueContextCache({ ...identidad, rol: "superadmin" }, NOW)
    expect(verifyContextCache(valor, { ...identidad, sub: "cuenta-2" }, NOW)).toBeUndefined()
  })

  it("rechaza una cookie de otra sesión del mismo sujeto", () => {
    const valor = issueContextCache({ ...identidad, rol: "admin" }, NOW)
    expect(verifyContextCache(valor, { ...identidad, sid: "sesion-2" }, NOW)).toBeUndefined()
    expect(verifyContextCache(valor, { sub: identidad.sub }, NOW)).toBeUndefined()
  })

  it("vence a los CONTEXT_CACHE_TTL_SECONDS", () => {
    const valor = issueContextCache({ ...identidad, rol: "cliente" }, NOW)
    const vence = NOW + CONTEXT_CACHE_TTL_SECONDS * 1_000
    expect(verifyContextCache(valor, identidad, vence - 1_000)).toBe("cliente")
    expect(verifyContextCache(valor, identidad, vence)).toBeUndefined()
  })

  it("rechaza una cookie emitida en el futuro", () => {
    const valor = issueContextCache({ ...identidad, rol: "admin" }, NOW + 60_000)
    expect(verifyContextCache(valor, identidad, NOW)).toBeUndefined()
  })

  it("rechaza un payload alterado aunque conserve la firma original", () => {
    const valor = issueContextCache({ ...identidad, rol: "cliente" }, NOW)!
    expect(verifyContextCache(reemplazarPayload(valor, { rol: "superadmin" }), identidad, NOW)).toBeUndefined()
  })

  it("rechaza una firma alterada o un formato inválido", () => {
    const valor = issueContextCache({ ...identidad, rol: "admin" }, NOW)!
    const [payload] = valor.split(".")
    expect(verifyContextCache(`${payload}.AAAA`, identidad, NOW)).toBeUndefined()
    expect(verifyContextCache(`${valor}.extra`, identidad, NOW)).toBeUndefined()
    expect(verifyContextCache(payload, identidad, NOW)).toBeUndefined()
  })

  it("rechaza una cookie firmada con la clave del ticket offline (separación de dominio)", () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        sub: identidad.sub,
        sid: identidad.sid,
        rol: "superadmin",
        issuedAt: NOW / 1_000,
        expiresAt: NOW / 1_000 + 60,
      }),
    ).toString("base64url")
    const firma = createHmac("sha256", SECRET).update(payload).digest("base64url")
    expect(verifyContextCache(`${payload}.${firma}`, identidad, NOW)).toBeUndefined()
  })

  it("rechaza un vencimiento más largo que el TTL o un rol desconocido", () => {
    const valor = issueContextCache({ ...identidad, rol: "admin" }, NOW)!
    expect(
      verifyContextCache(
        reemplazarPayload(valor, { expiresAt: NOW / 1_000 + CONTEXT_CACHE_TTL_SECONDS * 10 }),
        identidad,
        NOW,
      ),
    ).toBeUndefined()
    expect(verifyContextCache(reemplazarPayload(valor, { rol: "root" }), identidad, NOW)).toBeUndefined()
  })

  it("sin secreto configurado no emite ni acepta cookies", () => {
    const valor = issueContextCache({ ...identidad, rol: "admin" }, NOW)
    vi.stubEnv("OFFLINE_SESSION_SECRET", "")
    expect(issueContextCache({ ...identidad, rol: "admin" }, NOW)).toBeUndefined()
    expect(verifyContextCache(valor, identidad, NOW)).toBeUndefined()
  })
})
