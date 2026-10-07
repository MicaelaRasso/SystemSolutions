import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { RouteHandler } from "../_shared/transport.ts"

const { createAuthAdmin } = vi.hoisted(() => ({ createAuthAdmin: vi.fn() }))
vi.mock("../_shared/admin.ts", () => ({
  createAuthAdmin,
  invitationRedirectTo: () => "https://example.test/setup-password",
  passwordRecoveryRedirectTo: () => "https://example.test/reset-password",
  requireCreatedUser: (user: { id: string } | null, message: string) => {
    if (!user?.id) throw new Error(message)
    return user.id
  },
}))

let handler: RouteHandler
let completeAdminPasswordRecovery: typeof import("./index.ts").completeAdminPasswordRecovery

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: vi.fn(), env: { get: vi.fn() } })
  const identity = await import("./index.ts")
  handler = identity.identityAdminHandler
  completeAdminPasswordRecovery = identity.completeAdminPasswordRecovery
})

afterAll(() => vi.unstubAllGlobals())
beforeEach(() => vi.clearAllMocks())

const context = (
  request: Request,
  route: string[],
  body: Record<string, unknown>,
  rpc: ReturnType<typeof vi.fn>,
) => ({
  request,
  route,
  body,
  actor: { id: "actor-id", authorization: "Bearer token" },
  db: { rpc } as never,
  correlationId: "correlation-1",
  metadata: {} as never,
})

describe("identity account email safety", () => {
  it("rejects account email changes through the unverified admin route", async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    createAuthAdmin.mockResolvedValue({ auth: { admin: { updateUserById } } })
    const rpc = vi.fn()
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/account-id", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", activo: true }),
    })

    await expect(handler(context(request, ["accounts", "account-id"], {
      email: "new@example.test",
      activo: true,
    }, rpc))).rejects.toThrow("El email solo puede cambiarse mediante el flujo de verificación")

    expect(rpc).not.toHaveBeenCalled()
    expect(createAuthAdmin).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })

  it("checks account authorization before applying display metadata", async () => {
    const updateUserById = vi.fn().mockResolvedValue({ error: null })
    createAuthAdmin.mockResolvedValue({ auth: { admin: { updateUserById } } })
    const rpcError = { code: "42501", message: "Not allowed" }
    const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError })
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/account-id", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nombre: "Changed", activo: true }),
    })

    await expect(handler(context(request, ["accounts", "account-id"], {
      nombre: "Changed",
      activo: true,
    }, rpc))).resolves.toEqual({ data: null, error: rpcError })

    expect(createAuthAdmin).not.toHaveBeenCalled()
    expect(updateUserById).not.toHaveBeenCalled()
  })
})

describe("administrator provisioning", () => {
  it("sends the reset email before auditing, and returns audit failures", async () => {
    const sequence: string[] = []
    const sendEmail = vi.fn(async () => { sequence.push("send") })
    const rpc = vi.fn(async () => {
      sequence.push("audit")
      return { data: "audit-id", error: null }
    })

    await expect(completeAdminPasswordRecovery({ rpc } as never, "account-id", "account@example.test", sendEmail))
      .resolves.toEqual({ data: { sent: true }, error: null })
    expect(sequence).toEqual(["send", "audit"])
    expect(rpc).toHaveBeenCalledWith("api_record_auth_event", {
      action_name: "account_password_reset_requested",
      target_account: "account-id",
      event_outcome: "exitoso",
      event_details: {},
    })

    const auditFailure = { code: "42501", message: "audit denied" }
    const failedRpc = vi.fn().mockResolvedValue({ data: null, error: auditFailure })
    await expect(completeAdminPasswordRecovery({ rpc: failedRpc } as never, "account-id", "account@example.test", sendEmail))
      .resolves.toEqual({ data: null, error: auditFailure })
  })

  it("does not write a successful reset audit if email delivery fails", async () => {
    const rpc = vi.fn()
    const sendEmail = vi.fn().mockRejectedValue(new Error("Auth delivery failed"))
    await expect(completeAdminPasswordRecovery({ rpc } as never, "account-id", "account@example.test", sendEmail))
      .rejects.toThrow("Auth delivery failed")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("creates a fixed-role invitation and registers the Cuenta", async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: "new-account" } }, error: null })
    const deleteUser = vi.fn()
    createAuthAdmin.mockResolvedValue({ auth: { admin: { inviteUserByEmail, deleteUser } } })
    const created = { id: "new-account", rol: "super_administrador", estado: "pendiente" }
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: created, error: null })
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/administrators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new-admin@example.test",
        nombre: "Sol",
        apellido: "Admin",
        rol: "super_administrador",
      }),
    })

    await expect(handler(context(request, ["accounts", "administrators"], {
      email: "new-admin@example.test",
      nombre: "Sol",
      apellido: "Admin",
      rol: "super_administrador",
    }, rpc))).resolves.toEqual({ data: created, error: null })

    expect(inviteUserByEmail).toHaveBeenCalledWith("new-admin@example.test", {
      data: { nombre: "Sol", apellido: "Admin" },
      redirectTo: "https://example.test/setup-password",
    })
    expect(rpc).toHaveBeenNthCalledWith(1, "api_authorize_admin_account_create", {
      account_email: "new-admin@example.test",
      account_role: "super_administrador",
    })
    expect(rpc).toHaveBeenNthCalledWith(2, "api_create_admin_account", {
      account_id: "new-account",
      account_role: "super_administrador",
    })
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it("rolls back the invited Auth identity when Cuenta registration fails", async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: "new-account" } }, error: null })
    const deleteUser = vi.fn().mockResolvedValue({ error: null })
    createAuthAdmin.mockResolvedValue({ auth: { admin: { inviteUserByEmail, deleteUser } } })
    const registrationError = { code: "23505", message: "duplicate" }
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: registrationError })
      .mockResolvedValueOnce({ data: "audit-id", error: null })
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/administrators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "duplicate@example.test",
        nombre: "Sol",
        apellido: "Admin",
        rol: "administrador_regular",
      }),
    })

    await expect(handler(context(request, ["accounts", "administrators"], {
      email: "duplicate@example.test",
      nombre: "Sol",
      apellido: "Admin",
      rol: "administrador_regular",
    }, rpc))).resolves.toEqual({ data: null, error: registrationError })

    expect(deleteUser).toHaveBeenCalledWith("new-account")
  })

  it("does not send an administrator invitation when authorization fails", async () => {
    const inviteUserByEmail = vi.fn()
    createAuthAdmin.mockResolvedValue({ auth: { admin: { inviteUserByEmail } } })
    const denied = { code: "42501", message: "Only a super administrator can create administrators" }
    const rpc = vi.fn().mockResolvedValue({ data: null, error: denied })
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/administrators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new-admin@example.test",
        nombre: "Sol",
        apellido: "Admin",
        rol: "administrador_regular",
      }),
    })

    await expect(handler(context(request, ["accounts", "administrators"], {
      email: "new-admin@example.test",
      nombre: "Sol",
      apellido: "Admin",
      rol: "administrador_regular",
    }, rpc))).resolves.toEqual({ data: null, error: denied })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it("records an Auth invitation delivery failure without storing the email", async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "SMTP rejected private@example.test" } })
    createAuthAdmin.mockResolvedValue({ auth: { admin: { inviteUserByEmail } } })
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: "audit-id", error: null })
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/administrators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "private@example.test", rol: "administrador_regular" }),
    })

    await expect(handler(context(request, ["accounts", "administrators"], {
      email: "private@example.test",
      rol: "administrador_regular",
    }, rpc))).rejects.toThrow("No se pudo enviar la invitación")

    expect(rpc).toHaveBeenNthCalledWith(2, "api_record_auth_event", {
      action_name: "account_invited",
      target_account: null,
      event_outcome: "fallido",
      event_details: { reason: "auth_invite_failed" },
    })
    expect(JSON.stringify(rpc.mock.calls[1])).not.toContain("private@example.test")
  })

  it("records an email-change request attempt during authenticated preflight", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "audit-id", error: null })
    const preflightRequest = new Request("https://example.test/functions/v1/identity-admin/account-security/email-change", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test" }),
    })
    await expect(handler(context(preflightRequest, ["account-security", "email-change"], {
      email: "new@example.test",
    }, rpc))).resolves.toEqual({ data: "audit-id", error: null })
    expect(rpc).toHaveBeenCalledWith("api_record_auth_event", {
      action_name: "email_change_requested",
      target_account: "actor-id",
      event_outcome: "solicitado",
      event_details: {},
    })
  })

  it("renews a pending invitation for the same Auth identity", async () => {
    const inviteUserByEmail = vi.fn().mockResolvedValue({ data: { user: { id: "account-id" } }, error: null })
    createAuthAdmin.mockResolvedValue({ auth: { admin: { inviteUserByEmail } } })
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { id: "account-id", email: "pending@example.test" }, error: null })
      .mockResolvedValueOnce({ data: "audit-id", error: null })
    const resendRequest = new Request("https://example.test/functions/v1/identity-admin/accounts/account-id/invitation/resend", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    await expect(handler(context(resendRequest, ["accounts", "account-id", "invitation", "resend"], {}, rpc)))
      .resolves.toEqual({ data: { sent: true }, error: null })
    expect(inviteUserByEmail).toHaveBeenCalledWith("pending@example.test", {
      redirectTo: "https://example.test/setup-password",
    })
    expect(rpc).toHaveBeenNthCalledWith(1, "api_pending_invitation_target", { target: "account-id" })
    expect(rpc).toHaveBeenNthCalledWith(2, "api_record_auth_event", {
      action_name: "account_invitation_resent",
      target_account: "account-id",
      event_outcome: "exitoso",
      event_details: {},
    })
  })

  it("does not claim it recovered a lost email", async () => {
    const rpc = vi.fn()
    const recoveryRequest = new Request("https://example.test/functions/v1/identity-admin/accounts/account-id/email-recovery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "new@example.test", verification_reference: "case-123" }),
    })
    await expect(handler(context(recoveryRequest, ["accounts", "account-id", "email-recovery"], {
      email: "new@example.test",
      verification_reference: "case-123",
    }, rpc))).rejects.toThrow("no permite enviar un cambio de email administrado")
    expect(rpc).not.toHaveBeenCalled()
    expect(createAuthAdmin).not.toHaveBeenCalled()
  })

  it("rejects unsupported roles before sending an invitation", async () => {
    const rpc = vi.fn()
    const request = new Request("https://example.test/functions/v1/identity-admin/accounts/administrators", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.test", rol: "cliente" }),
    })

    await expect(handler(context(request, ["accounts", "administrators"], {
      email: "person@example.test",
      rol: "cliente",
    }, rpc))).rejects.toThrow("El rol de administrador no es válido")

    expect(createAuthAdmin).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
