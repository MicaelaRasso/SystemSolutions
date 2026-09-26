import { routeNotFound } from "../_shared/http.ts"
import { createAuthAdmin, requireCreatedUser } from "../_shared/admin.ts"
import { serveFunction } from "../_shared/transport.ts"

const rowBy = (rows: unknown, key: "id" | "usuario_id", value: string) =>
  Array.isArray(rows)
    ? rows.find((row) => row && typeof row === "object" && (row as Record<string, unknown>)[key] === value)
    : undefined

serveFunction("identity-admin", async ({ request, route, body, db, correlationId }) => {
  if (route.length === 0 || route[0] === "context") return db.rpc("api_context")

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
    const auth = await createAuthAdmin()
    const invited = await auth.auth.admin.inviteUserByEmail(String(body.email), {
      data: { nombre: body.nombre, apellido: body.apellido },
    })
    const accountId = requireCreatedUser(invited.data.user, invited.error?.message ?? "No se pudo crear la cuenta")
    try {
      const registered = await db.rpc("api_create_client_account", {
        target_client: body.client_id,
        account_id: accountId,
      })
      if (registered.error) throw registered.error
      await auth.auth.admin.updateUserById(accountId, {
        user_metadata: { nombre: body.nombre, apellido: body.apellido },
      })
    } catch (error) {
      await auth.auth.admin.deleteUser(accountId)
      throw error
    }
    const rows = await db.rpc("api_client_accounts", { target_client: body.client_id })
    return { data: rowBy(rows.data, "id", accountId), error: rows.error }
  }

  if (route[0] === "accounts" && request.method === "PATCH" && route.length === 2) {
    const auth = await createAuthAdmin()
    const accountId = route[1]
    const updated = await auth.auth.admin.updateUserById(accountId, {
      email: typeof body.email === "string" ? body.email : undefined,
      user_metadata: { nombre: body.nombre, apellido: body.apellido },
    })
    if (updated.error) throw new Error(updated.error.message)
    const rows = await db.rpc("api_update_account", { target: accountId, account_active: body.activo !== false })
    return rows
  }

  if (route[0] === "accounts" && request.method === "DELETE" && route.length === 2) {
    const auth = await createAuthAdmin()
    const accountId = route[1]
    const removed = await db.rpc("api_delete_account", { target: accountId })
    if (removed.error) return removed
    const deleted = await auth.auth.admin.deleteUser(accountId)
    if (deleted.error) throw new Error(deleted.error.message)
    return { data: null, error: null }
  }

  if (route[0] === "mobile-workshops" && request.method === "GET" && route.length === 1)
    return db.rpc("api_workshops")

  if (route[0] === "mobile-workshops" && request.method === "POST" && route.length === 1) {
    const auth = await createAuthAdmin()
    const invited = await auth.auth.admin.inviteUserByEmail(String(body.email), {
      data: { nombre: body.nombre ?? body.name ?? body.nombre_taller, apellido: "" },
    })
    const accountId = requireCreatedUser(invited.data.user, invited.error?.message ?? "No se pudo crear la cuenta del Taller")
    try {
      const workshop = await db.rpc("api_create_workshop", {
        workshop_name: body.nombre,
        workshop_color: body.color,
        account_id: accountId,
      })
      if (workshop.error) throw workshop.error
    } catch (error) {
      await auth.auth.admin.deleteUser(accountId)
      throw error
    }
    const rows = await db.rpc("api_workshops")
    return { data: rowBy(rows.data, "usuario_id", accountId), error: rows.error }
  }

  if (route[0] === "mobile-workshops" && request.method === "PATCH" && route.length === 2) {
    const auth = await createAuthAdmin()
    const account = await db.rpc("api_workshops")
    const current = Array.isArray(account.data)
      ? account.data.find((row) => row && typeof row === "object" && (row as { id?: unknown }).id === route[1]) as { usuario_id?: string } | undefined
      : undefined
    if (current?.usuario_id && typeof body.email === "string") {
      const updated = await auth.auth.admin.updateUserById(current.usuario_id, { email: body.email })
      if (updated.error) throw new Error(updated.error.message)
    }
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
})
