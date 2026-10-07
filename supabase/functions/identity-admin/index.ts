import { routeNotFound } from "../_shared/http.ts"
import { createAuthAdmin, invitationRedirectTo, passwordRecoveryRedirectTo, requireCreatedUser } from "../_shared/admin.ts"
import { HttpError } from "../_shared/errors.ts"
import { runtimeEnv } from "../_shared/runtime-env.ts"
import { serveFunction, type RouteHandler } from "../_shared/transport.ts"

const rowBy = (rows: unknown, key: "id" | "usuario_id", value: string) =>
  Array.isArray(rows)
    ? rows.find((row) => row && typeof row === "object" && (row as Record<string, unknown>)[key] === value)
    : undefined

const mappedRpcErrorCode = (code: unknown) => {
  if (code === "forbidden") return "42501"
  if (code === "not_found") return "P0002"
  if (code === "duplicate_email") return "23505"
  if (code === "invalid_role" || code === "invalid_email") return "22023"
  return typeof code === "string" ? code : undefined
}

const normalizeRpcResult = (result: { data: unknown; error: { code?: string; message?: string } | null }) => {
  if (result.error) return result
  if (!result.data || typeof result.data !== "object" || !("data" in result.data) || !("error" in result.data))
    return result
  const value = result.data as { data?: unknown; error?: { code?: unknown; message?: unknown } | null }
  const nestedError = value.error && typeof value.error === "object"
    ? {
      code: mappedRpcErrorCode(value.error.code),
      message: typeof value.error.message === "string" ? value.error.message : "Account operation failed",
    }
    : null
  return { data: value.data ?? null, error: nestedError }
}

const accountRpc = async (
  db: { rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message?: string } | null }> },
  name: string,
  args?: Record<string, unknown>,
) => normalizeRpcResult(await db.rpc(name, args))

const recordFailedInvite = (db: Parameters<typeof accountRpc>[0], details: Record<string, unknown>) =>
  accountRpc(db, "api_record_auth_event", {
    action_name: "account_invited",
    target_account: null,
    event_outcome: "fallido",
    event_details: details,
  })

export const completeAdminPasswordRecovery = async (
  db: Parameters<typeof accountRpc>[0],
  accountId: string,
  email: string,
  sendEmail: (targetEmail: string) => Promise<void>,
) => {
  await sendEmail(email)
  const audited = await accountRpc(db, "api_record_auth_event", {
    action_name: "account_password_reset_requested",
    target_account: accountId,
    event_outcome: "exitoso",
    event_details: {},
  })
  if (audited.error) return audited
  return { data: { sent: true }, error: null }
}

export const identityAdminHandler: RouteHandler = async ({ request, route, body, actor, db, correlationId }) => {
  if (route.length === 0 || route[0] === "context") return db.rpc("api_context")

  if (route[0] === "account-security" && route[1] === "email-change" && request.method === "PUT" && route.length === 2) {
    const email = typeof body.email === "string" ? body.email.trim() : ""
    if (!email || !email.includes("@")) throw new HttpError(400, "El email de la cuenta no es válido")
    return accountRpc(db, "api_record_auth_event", {
      action_name: "email_change_requested",
      target_account: actor.id,
      event_outcome: "solicitado",
      event_details: {},
    })
  }

  if (route[0] === "accounts" && route[1] === "administrators" && request.method === "GET" && route.length === 2)
    return accountRpc(db, "api_admin_accounts")

  if (route[0] === "accounts" && route[1] === "administrators" && request.method === "POST" && route.length === 2) {
    const role = body.rol
    if (role !== "administrador_regular" && role !== "super_administrador")
      throw new HttpError(400, "El rol de administrador no es válido")
    const email = typeof body.email === "string" ? body.email.trim() : ""
    if (!email || !email.includes("@")) throw new HttpError(400, "El email de la cuenta no es válido")
    const authorized = await accountRpc(db, "api_authorize_admin_account_create", {
      account_email: email,
      account_role: role,
    })
    // Return database denials through transport so authorization failures get
    // the right HTTP status and the sensitive-attempt audit path.
    if (authorized.error) return authorized
    const auth = await createAuthAdmin()
    const redirectTo = invitationRedirectTo(request)
    const invited = await auth.auth.admin.inviteUserByEmail(email, {
      data: { nombre: body.nombre, apellido: body.apellido },
      ...(redirectTo ? { redirectTo } : {}),
    })
    if (invited.error) {
      const isDuplicate = /already|exists|registered|duplicate/i.test(invited.error.message)
      const audited = await recordFailedInvite(db, { reason: isDuplicate ? "duplicate_email" : "auth_invite_failed" })
      if (audited.error) return audited
      if (isDuplicate)
        throw new HttpError(409, "Ya existe una cuenta con ese email")
      throw new HttpError(502, "No se pudo enviar la invitación")
    }
    const accountId = requireCreatedUser(invited.data.user, invited.error?.message ?? "No se pudo crear la cuenta")
    let registered
    try {
      registered = await accountRpc(db, "api_create_admin_account", {
        account_id: accountId,
        account_role: role,
      })
    } catch (error) {
      const rollback = await auth.auth.admin.deleteUser(accountId)
      if (rollback.error)
        throw new Error(`No se pudo registrar la cuenta y falló la reversión de Auth: ${rollback.error.message}`)
      throw error
    }
    if (registered.error) {
      const rollback = await auth.auth.admin.deleteUser(accountId)
      if (rollback.error)
        throw new Error(`No se pudo registrar la cuenta y falló la reversión de Auth: ${rollback.error.message}`)
      const audited = await recordFailedInvite(db, { reason: "account_registration_failed" })
      if (audited.error) return audited
      return registered
    }
    return registered
  }

  if (route[0] === "accounts" && route[1] === "administrators" && request.method === "PATCH" && route.length === 3)
    return accountRpc(db, "api_update_admin_account", {
      target: route[2],
      account_active: body.activo !== false,
    })

  if (route[0] === "accounts" && route[2] === "invitation" && route[3] === "resend" && request.method === "POST" && route.length === 4) {
    const target = await accountRpc(db, "api_pending_invitation_target", { target: route[1] })
    if (target.error) return target
    const inviteTarget = target.data && typeof target.data === "object"
      ? target.data as Record<string, unknown>
      : null
    const accountId = typeof inviteTarget?.id === "string" ? inviteTarget.id : null
    const email = typeof inviteTarget?.email === "string" ? inviteTarget.email : null
    if (!accountId || !email) throw new Error("No se pudo obtener la Cuenta pendiente de invitación")

    const auth = await createAuthAdmin()
    const redirectTo = invitationRedirectTo(request)
    const invited = redirectTo
      ? await auth.auth.admin.inviteUserByEmail(email, { redirectTo })
      : await auth.auth.admin.inviteUserByEmail(email)
    const recordResend = (outcome: "exitoso" | "fallido", details: Record<string, unknown> = {}) =>
      accountRpc(db, "api_record_auth_event", {
        action_name: "account_invitation_resent",
        target_account: accountId,
        event_outcome: outcome,
        event_details: details,
      })

    if (invited.error) {
      const audited = await recordResend("fallido", { reason: "auth_invite_failed" })
      if (audited.error) return audited
      throw new HttpError(502, "No se pudo enviar la invitación")
    }

    if (invited.data.user?.id !== accountId) {
      const audited = await recordResend("fallido", { reason: "auth_identity_mismatch" })
      if (audited.error) return audited
      throw new HttpError(502, "No se pudo renovar la invitación de la cuenta")
    }

    const audited = await recordResend("exitoso")
    if (audited.error) return audited
    return { data: { sent: true }, error: null }
  }

  if (route[0] === "accounts" && route[2] === "email-recovery" && request.method === "POST" && route.length === 3)
    throw new HttpError(501, "Supabase Auth no permite enviar un cambio de email administrado con verificación de la nueva dirección")

  if (route[0] === "accounts" && request.method === "POST" && route.length === 3 && route[2] === "recovery") {
    const target = await accountRpc(db, "api_admin_recovery_email", { target: route[1] })
    if (target.error) return target
    const email = typeof target.data === "string"
      ? target.data
      : target.data && typeof target.data === "object" && typeof (target.data as Record<string, unknown>).email === "string"
        ? (target.data as Record<string, string>).email
        : null
    if (!email) throw new Error("No se pudo iniciar la recuperación de la cuenta")

    const sendEmail = async (targetEmail: string) => {
      const env = runtimeEnv()
      if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
        throw new Error("Supabase Auth no está configurado para enviar la recuperación")
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.117.2")
      const auth = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
      const redirectTo = passwordRecoveryRedirectTo(request)
      const sent = await auth.auth.resetPasswordForEmail(targetEmail,
        redirectTo ? { redirectTo } : undefined)
      if (sent.error) throw new Error("No se pudo enviar la recuperación de la cuenta")
    }
    return completeAdminPasswordRecovery(db, route[1], email, sendEmail)
  }

  if (route[0] === "accounts" && request.method === "GET" && route.length === 1) {
    const clientId = new URL(request.url).searchParams.get("client_id")
    if (!clientId) return { data: [], error: null }
    return db.rpc("api_client_accounts", { target_client: clientId })
  }

  if (route[0] === "accounts" && request.method === "GET" && route.length === 3 && route[2] === "access-scopes")
    return db.rpc("api_account_access", { target: route[1] })

  if (route[0] === "accounts" && request.method === "PUT" && route.length === 3 && route[2] === "access-scopes")
    return db.rpc("api_set_account_access", { target: route[1], scopes: body.scopes ?? [] })

  if (route[0] === "accounts" && request.method === "POST" && route.length === 1) {
    const authorized = await accountRpc(db, "api_authorize_account_provisioning", {
      account_kind: "cliente",
      target_client: body.client_id,
    })
    if (authorized.error) return authorized
    const auth = await createAuthAdmin()
    const redirectTo = invitationRedirectTo(request)
    const invited = await auth.auth.admin.inviteUserByEmail(String(body.email), {
      data: { nombre: body.nombre, apellido: body.apellido },
      ...(redirectTo ? { redirectTo } : {}),
    })
    if (invited.error) {
      const isDuplicate = /already|exists|registered|duplicate/i.test(invited.error.message)
      const audited = await recordFailedInvite(db, { reason: isDuplicate ? "duplicate_email" : "auth_invite_failed" })
      if (audited.error) return audited
      if (isDuplicate)
        throw new HttpError(409, "Ya existe una cuenta con ese email")
      throw new HttpError(502, "No se pudo enviar la invitación")
    }
    const accountId = requireCreatedUser(invited.data.user, invited.error?.message ?? "No se pudo crear la cuenta")
    const registered = await accountRpc(db, "api_create_client_account", {
      target_client: body.client_id,
      account_id: accountId,
    })
    if (registered.error) {
      const rollback = await auth.auth.admin.deleteUser(accountId)
      if (rollback.error)
        throw new Error(`No se pudo registrar la cuenta y falló la reversión de Auth: ${rollback.error.message}`)
      const audited = await recordFailedInvite(db, { reason: "account_registration_failed" })
      if (audited.error) return audited
      return registered
    }
    const rows = await db.rpc("api_client_accounts", { target_client: body.client_id })
    return { data: rowBy(rows.data, "id", accountId), error: rows.error }
  }

  if (route[0] === "accounts" && request.method === "PATCH" && route.length === 2) {
    if ("email" in body)
      throw new HttpError(400, "El email solo puede cambiarse mediante el flujo de verificación de cuenta")
    const accountId = route[1]
    const rows = await db.rpc("api_update_account", { target: accountId, account_active: body.activo !== false })
    if (rows.error) return rows
    // Admin Auth updates bypass Supabase's email confirmation workflow. Keep
    // this route limited to profile metadata; email changes use the verified
    // account-security flow.
    if (typeof body.nombre === "string" || typeof body.apellido === "string") {
      const auth = await createAuthAdmin()
      const updated = await auth.auth.admin.updateUserById(accountId, {
        user_metadata: { nombre: body.nombre, apellido: body.apellido },
      })
      if (updated.error) throw new Error(updated.error.message)
    }
    return rows
  }

  if (route[0] === "accounts" && request.method === "DELETE" && route.length === 2) {
    return db.rpc("api_delete_account", { target: route[1] })
  }

  if (route[0] === "mobile-workshops" && request.method === "GET" && route.length === 1)
    return db.rpc("api_workshops")

  if (route[0] === "mobile-workshops" && request.method === "POST" && route.length === 1) {
    const authorized = await accountRpc(db, "api_authorize_account_provisioning", {
      account_kind: "taller_movil",
      target_client: null,
    })
    if (authorized.error) return authorized
    const auth = await createAuthAdmin()
    const redirectTo = invitationRedirectTo(request)
    const invited = await auth.auth.admin.inviteUserByEmail(String(body.email), {
      data: { nombre: body.nombre ?? body.name ?? body.nombre_taller, apellido: "" },
      ...(redirectTo ? { redirectTo } : {}),
    })
    if (invited.error) {
      const isDuplicate = /already|exists|registered|duplicate/i.test(invited.error.message)
      const audited = await recordFailedInvite(db, { reason: isDuplicate ? "duplicate_email" : "auth_invite_failed" })
      if (audited.error) return audited
      if (isDuplicate)
        throw new HttpError(409, "Ya existe una cuenta con ese email")
      throw new HttpError(502, "No se pudo enviar la invitación")
    }
    const accountId = requireCreatedUser(invited.data.user, invited.error?.message ?? "No se pudo crear la cuenta del Taller")
    const workshop = await accountRpc(db, "api_create_workshop", {
      workshop_name: body.nombre,
      workshop_color: body.color,
      account_id: accountId,
    })
    if (workshop.error) {
      const rollback = await auth.auth.admin.deleteUser(accountId)
      if (rollback.error)
        throw new Error(`No se pudo registrar la cuenta y falló la reversión de Auth: ${rollback.error.message}`)
      const audited = await recordFailedInvite(db, { reason: "account_registration_failed" })
      if (audited.error) return audited
      return workshop
    }
    const rows = await db.rpc("api_workshops")
    return { data: rowBy(rows.data, "usuario_id", accountId), error: rows.error }
  }

  if (route[0] === "mobile-workshops" && request.method === "PATCH" && route.length === 2) {
    if ("email" in body)
      throw new HttpError(400, "El email solo puede cambiarse mediante el flujo de verificación de cuenta")
    // Updating email through the Auth Admin API skips the verification and
    // old-address notification required by ADR-0021. Keep this route focused
    // on workshop details and access state.
    return db.rpc("api_update_workshop", {
      target: route[1], workshop_name: body.nombre, workshop_color: body.color, workshop_active: body.activo !== false,
    })
  }

  if (route[0] === "technicians" && request.method === "GET" && route.length === 1)
    return db.rpc("api_people")
  if (route[0] === "technicians" && request.method === "POST" && route.length === 1)
    return db.rpc("api_create_person", { person_name: body.nombre, person_last_name: body.apellido, person_dni: body.dni, person_active: body.activo !== false })
  if (route[0] === "technicians" && request.method === "PATCH" && route.length === 2)
    return db.rpc("api_update_person", { target: route[1], person_name: body.nombre, person_last_name: body.apellido, person_dni: body.dni, person_active: body.activo !== false })

  if (route[0] === "staffing" && request.method === "GET" && route.length === 1) {
    const query = new URL(request.url).searchParams
    return db.rpc("api_staffing", { from_date: query.get("from"), to_date: query.get("to") })
  }
  if (route[0] === "staffing" && request.method === "PUT" && route.length === 3)
    return db.rpc("api_set_staffing", { target_taller: route[1], target_date: route[2], ids: body.persona_ids ?? [] })
  if (route[0] === "staffing" && request.method === "POST" && route.length === 2 && route[1] === "copy-previous-week")
    return db.rpc("api_copy_staffing", { previous_monday: body.lunes })

  if (route[0] === "catalogs" && request.method === "GET" && route.length === 2 && route[1] === "summary")
    return db.rpc("api_catalog_summary")
  if (route[0] === "catalogs" && request.method === "GET" && route.length === 3 && route[2] === "options")
    return db.rpc("api_catalog_options", { target_list: route[1], include_inactive: false })
  if (route[0] === "catalogs" && request.method === "GET" && route.length === 2)
    return db.rpc("api_catalog_options", { target_list: route[1], include_inactive: true })
  if (route[0] === "catalogs" && request.method === "POST" && route.length === 3 && route[2] === "options")
    return db.rpc("api_create_catalog_option", { target_list: route[1], option_value: body.valor })
  if (route[0] === "catalogs" && request.method === "PUT" && route.length === 3 && route[2] === "order")
    return db.rpc("api_reorder_catalog", { target_list: route[1], option_ids: body.ids ?? [] })
  if (route[0] === "catalog-options" && request.method === "PATCH" && route.length === 2)
    return db.rpc("api_update_catalog_option", { target: route[1], option_value: body.valor, option_active: body.activo })

  if (route[0] === "test-standards" && request.method === "GET" && route.length === 1)
    return db.rpc("api_test_standards")
  if (route[0] === "test-standards" && request.method === "POST" && route.length === 1)
    return db.rpc("api_create_test_standard", { standard_name: body.nombre, standard_serial: body.nro_serie, standard_expiry: body.vencimiento, standard_active: body.activo !== false })
  if (route[0] === "test-standards" && request.method === "PATCH" && route.length === 2)
    return db.rpc("api_update_test_standard", { target: route[1], standard_name: body.nombre, standard_serial: body.nro_serie, standard_expiry: body.vencimiento, standard_active: body.activo !== false })

  return routeNotFound(request, correlationId)
}

serveFunction("identity-admin", identityAdminHandler)
