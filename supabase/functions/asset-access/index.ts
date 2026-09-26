import { isValveUpdatePayload } from "../_shared/validation.ts"
import { createAuthAdmin, requireCreatedUser } from "../_shared/admin.ts"
import { json, routeNotFound } from "../_shared/http.ts"
import { createSignedStorageUrl, removeStorageObject, safeObjectName, uploadStorageObject, validateStorageObject } from "../_shared/storage.ts"
import { serveFunction } from "../_shared/transport.ts"

serveFunction("asset-access", async ({ request, route, body, db, correlationId }) => {
  const segments = route

  const withLogoUrl = async (value: unknown) => {
    if (!value || typeof value !== "object") return value
    const client = value as Record<string, unknown>
    const logo = client.logo_url
    if (!logo || typeof logo !== "object") return value
    const path = (logo as Record<string, unknown>).path
    const bucket = (logo as Record<string, unknown>).bucket
    if (typeof path !== "string" || typeof bucket !== "string") return value
    return { ...client, logo_url: await createSignedStorageUrl(bucket, path) }
  }

  // Frontend: /admin/clientes -> backend: Cliente lifecycle. Auth account
  // creation happens here so the browser never receives a service-role key.
  if (segments[0] === "clients" && request.method === "GET" && segments.length === 1) {
    const query = new URL(request.url).searchParams
    const rows = await db.rpc("api_client_rows")
    if (rows.error) return rows
    const q = query.get("q")?.trim().toLowerCase() ?? ""
    const includeInactive = query.get("include_inactive") !== "false"
    const data = Array.isArray(rows.data)
      ? await Promise.all(rows.data.filter((row) => {
          if (!row || typeof row !== "object") return false
          const value = row as Record<string, unknown>
          if (!includeInactive && value.activo === false) return false
          if (!q) return true
          return [value.razon_social, value.cuit, value.contacto]
            .filter((item): item is string => typeof item === "string")
            .some((item) => item.toLowerCase().includes(q))
        }).map(withLogoUrl))
      : []
    return { data, error: null }
  }

  if (segments[0] === "clients" && request.method === "GET" && segments.length === 2) {
    const client = await db.rpc("api_client", { target: segments[1] })
    if (client.error) return client
    return { data: await withLogoUrl(client.data), error: null }
  }

  if (segments[0] === "clients" && request.method === "POST" && segments.length === 1) {
    const auth = await createAuthAdmin()
    const invited = await auth.auth.admin.inviteUserByEmail(String(body.email), {
      data: { nombre: body.contacto, apellido: "" },
    })
    const accountId = requireCreatedUser(invited.data.user, invited.error?.message ?? "No se pudo crear el Cliente")
    try {
      await db.rpc("api_register_client_account", { account_id: accountId })
      const client = await db.rpc("api_create_client", {
        client_cuenta: accountId,
        client_name: body.razon_social,
        client_cuit: body.cuit,
        client_contacto: body.contacto,
        client_telefono: body.telefono,
        client_email: body.email,
        client_direccion: body.direccion,
        client_aviso: body.aviso_vencimiento !== false,
        client_activo: body.activo !== false,
      })
      if (client.error) throw client.error
      return { data: await withLogoUrl(client.data), error: null }
    } catch (error) {
      await auth.auth.admin.deleteUser(accountId)
      throw error
    }
  }

  if (segments[0] === "clients" && request.method === "PATCH" && segments.length === 2)
    return db.rpc("api_update_client", {
      target: segments[1], client_name: body.razon_social, client_cuit: body.cuit,
      client_contacto: body.contacto, client_telefono: body.telefono, client_email: body.email,
      client_direccion: body.direccion, client_aviso: body.aviso_vencimiento !== false,
      client_activo: body.activo !== false,
    })

  if (segments[0] === "clients" && request.method === "PUT" && segments.length === 3 && segments[2] === "logo") {
    const file = body.file instanceof File ? body.file : null
    if (!file) return json(request, { error: "A logo file is required" }, 400, correlationId)
    const objectName = safeObjectName(`clients/${segments[1]}/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "-")}`)
    const validation = validateStorageObject({ objectName, contentType: file.type, size: file.size }, {
      allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/svg+xml"], maxBytes: 5 * 1024 * 1024,
    })
    if (!validation.ok) return json(request, { error: validation.error }, 400, correlationId)
    await uploadStorageObject("client-logos", validation.metadata.objectName, file)
    const client = await db.rpc("api_set_client_logo", { target: segments[1], bucket_name: "client-logos", object_path: validation.metadata.objectName })
    if (client.error) return client
    return { data: await withLogoUrl(client.data), error: null }
  }

  if (segments[0] === "clients" && request.method === "DELETE" && segments.length === 3 && segments[2] === "logo") {
    const current = await db.rpc("api_client", { target: segments[1] })
    if (current.error) return current
    const logo = current.data && typeof current.data === "object" ? (current.data as Record<string, unknown>).logo_url : null
    if (logo && typeof logo === "object" && typeof (logo as Record<string, unknown>).bucket === "string" && typeof (logo as Record<string, unknown>).path === "string")
      await removeStorageObject((logo as Record<string, string>).bucket, (logo as Record<string, string>).path)
    return db.rpc("api_set_client_logo", { target: segments[1], bucket_name: null, object_path: null })
  }

  if (segments[0] === "yacimientos" && request.method === "GET" && !segments[1])
    return db.rpc("api_yacimientos")
  if (segments[0] === "yacimientos" && request.method === "POST" && !segments[1])
    return db.rpc("api_create_yacimiento_for_actor", {
      target_client: body.client_id ?? null,
      asset_name: body.name,
      asset_provincia: body.provincia,
      asset_operadora: body.operadora,
      asset_contratista: body.contratista,
    })
  if (segments[0] === "yacimientos" && request.method === "PATCH" && segments[1] && !segments[2])
    return db.rpc("api_update_yacimiento_for_actor", {
      target: segments[1],
      asset_name: body.name,
      asset_provincia: body.provincia,
      asset_operadora: body.operadora,
      asset_contratista: body.contratista,
    })
  if (
    segments[0] === "yacimientos" &&
    segments[1] &&
    segments[2] === "tree" &&
    request.method === "GET"
  )
    return db.rpc("api_yacimiento_tree", { target: segments[1] })
  if (
    segments[0] === "yacimientos" &&
    segments[1] &&
    segments[2] === "assignment" &&
    request.method === "GET"
  )
    return db.rpc("api_assignment", { target: segments[1] })
  if (segments[0] === "hierarchy" && request.method === "POST")
    return db.rpc("api_create_descendant_for_actor", {
      kind: body.kind,
      parent_id: body.parent_id,
      asset_name: body.name,
    })
  if (segments[0] === "hierarchy" && request.method === "PATCH" && segments[1])
    return db.rpc("api_update_descendant_for_actor", {
      kind: body.kind,
      target: segments[1],
      asset_name: body.name,
    })
  if (segments[0] === "valves" && request.method === "GET" && segments[1] && !segments[2])
    return db.rpc("api_valvula", {
      target: segments[1],
    })
  if (segments[0] === "valves" && request.method === "PATCH" && segments[1] && !segments[2]) {
    if (!isValveUpdatePayload(body))
      return json(request, { error: "Invalid valve update payload" }, 400, correlationId)
    return db.rpc("api_update_valvula", {
      target: segments[1],
      asset_name: body.name,
      asset_marca: body.marca,
      asset_numero_serie: body.numero_serie,
      asset_modelo: body.modelo,
      asset_tipo: body.tipo,
      asset_diametro_entrada: body.diametro_entrada,
      asset_clase_entrada: body.clase_entrada,
      asset_diametro_salida: body.diametro_salida,
      asset_clase_salida: body.clase_salida,
      asset_rosca: body.rosca,
      asset_razon_disponibilidad: body.razon_disponibilidad,
    })
  }

  return routeNotFound(request, correlationId)
})
