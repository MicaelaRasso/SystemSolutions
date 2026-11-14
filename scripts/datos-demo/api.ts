import { type FuncionEdge, CONTRASENA, sql } from "../../e2e/support/api"
import {
  BASE_URL,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_JWT,
  SUPABASE_URL,
} from "../../e2e/support/entorno"
import { asegurarDestinoLocal } from "./destino"

/**
 * Cliente HTTP del cargador: llama a las Edge Functions como lo haría el navegador, con la sesión
 * de cualquier cuenta de demo (las de `e2e/support/api.ts` están fijas a cinco roles).
 */

const tokens = new Map<string, { token: string; vence: number }>()

function urlLocal(ruta: string) {
  asegurarDestinoLocal()
  return `${SUPABASE_URL}${ruta}`
}

async function tokenDe(email: string) {
  const guardado = tokens.get(email)
  if (guardado && guardado.vence > Date.now()) return guardado.token
  const respuesta = await fetch(urlLocal("/auth/v1/token?grant_type=password"), {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password: CONTRASENA }),
  })
  const cuerpo = (await respuesta.json()) as { access_token?: string; expires_in?: number }
  if (!respuesta.ok || !cuerpo.access_token) {
    throw new Error(`No se pudo iniciar sesión como ${email}: ${respuesta.status}`)
  }
  const nuevo = {
    token: cuerpo.access_token,
    vence: Date.now() + (cuerpo.expires_in ?? 3600) * 900,
  }
  tokens.set(email, nuevo)
  return nuevo.token
}

export type OpcionesLlamada = {
  method?: string
  /** Cuerpo JSON. */
  body?: unknown
  /** Cuerpo multipart (fotos, firmas, logo). */
  form?: Record<string, string | Blob>
}

/** Llama a una Edge Function con la sesión de `email`; un estado de error corta la carga. */
export async function llamar<T>(
  email: string,
  funcion: FuncionEdge,
  ruta: string,
  opciones: OpcionesLlamada = {},
): Promise<T> {
  const headers: Record<string, string> = {
    apikey: PUBLISHABLE_KEY,
    authorization: `Bearer ${await tokenDe(email)}`,
    origin: BASE_URL,
  }
  let body: BodyInit | undefined
  if (opciones.form) {
    const form = new FormData()
    for (const [clave, valor] of Object.entries(opciones.form)) form.set(clave, valor)
    body = form
  } else if (opciones.body !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(opciones.body)
  }
  const metodo = opciones.method ?? (body ? "POST" : "GET")
  const respuesta = await fetch(urlLocal(`/functions/v1/${funcion}/${ruta}`), {
    method: metodo,
    headers,
    body,
  })
  const texto = await respuesta.text()
  if (!respuesta.ok) {
    throw new Error(
      `${metodo} ${funcion}/${ruta} como ${email}: ${respuesta.status} ${texto.slice(0, 400)}`,
    )
  }
  const json = JSON.parse(texto) as unknown
  return (
    json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json
  ) as T
}

/**
 * Las cuentas creadas por la app quedan invitadas (sin contraseña). En el stack local se les fija
 * la contraseña de demo y se confirma el correo con la clave de servicio de demostración de la
 * CLI; la confirmación activa la cuenta por el trigger `auth_user_confirmation_activates_cuenta`.
 */
export async function activarCuentaInvitada(email: string) {
  const id = sql(
    `select id from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}')`,
  )
  if (!id) throw new Error(`No existe el usuario ${email}`)
  const respuesta = await fetch(urlLocal(`/auth/v1/admin/users/${id}`), {
    method: "PUT",
    headers: {
      apikey: SERVICE_ROLE_JWT,
      authorization: `Bearer ${SERVICE_ROLE_JWT}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: CONTRASENA, email_confirm: true }),
  })
  if (!respuesta.ok) throw new Error(`No se pudo activar ${email}: ${respuesta.status}`)
  return id
}
