import { execFileSync } from "node:child_process"

import {
  asegurarContenedorPermitido,
  asegurarUrlLocal,
  BASE_URL,
  CONTENEDOR_DB,
  PUBLISHABLE_KEY,
  SERVICE_ROLE_JWT,
  SUPABASE_URL,
} from "./entorno"

export type Rol = "super" | "admin" | "taller" | "cliente" | "cliente2"

export const CONTRASENA = "demo1234"

export const EMAIL: Record<Rol, string> = {
  super: "super@local.test",
  admin: "admin@local.test",
  taller: "taller@local.test",
  cliente: "cliente@local.test",
  cliente2: "cliente2@local.test",
}

export type FuncionEdge =
  | "asset-access"
  | "audit-log"
  | "backup-export"
  | "certificate-field"
  | "identity-admin"
  | "offline-sync"
  | "service-workflow"

export type RespuestaEdge = { status: number; texto: string; datos: unknown }

const tokens = new Map<Rol, { token: string; vence: number }>()

function urlLocal(ruta: string) {
  asegurarUrlLocal(SUPABASE_URL)
  return `${SUPABASE_URL}${ruta}`
}

async function pedirToken(rol: Rol) {
  const respuesta = await fetch(urlLocal("/auth/v1/token?grant_type=password"), {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL[rol], password: CONTRASENA }),
  })
  const cuerpo = (await respuesta.json()) as { access_token?: string; expires_in?: number }
  if (!respuesta.ok || !cuerpo.access_token) {
    throw new Error(`No se pudo iniciar sesión como ${rol}: ${respuesta.status}`)
  }
  return { token: cuerpo.access_token, vence: Date.now() + (cuerpo.expires_in ?? 3600) * 900 }
}

export async function tokenDe(rol: Rol) {
  const guardado = tokens.get(rol)
  if (guardado && guardado.vence > Date.now()) return guardado.token
  const nuevo = await pedirToken(rol)
  tokens.set(rol, nuevo)
  return nuevo.token
}

/** Llama a una Edge Function como lo haría el navegador y devuelve la respuesta sin juzgarla. */
export async function edgeCrudo(
  rol: Rol,
  funcion: FuncionEdge,
  ruta: string,
  opciones: { method?: string; body?: unknown } = {},
): Promise<RespuestaEdge> {
  const respuesta = await fetch(urlLocal(`/functions/v1/${funcion}/${ruta}`), {
    method: opciones.method ?? "GET",
    headers: {
      apikey: PUBLISHABLE_KEY,
      authorization: `Bearer ${await tokenDe(rol)}`,
      "content-type": "application/json",
      origin: BASE_URL,
    },
    body: opciones.body === undefined ? undefined : JSON.stringify(opciones.body),
  })
  const texto = await respuesta.text()
  let datos: unknown = texto
  try {
    const json = JSON.parse(texto) as unknown
    datos =
      json && typeof json === "object" && "data" in json ? (json as { data: unknown }).data : json
  } catch {
    // Las descargas y los errores de la plataforma no siempre son JSON.
  }
  return { status: respuesta.status, texto, datos }
}

/** Igual que `edgeCrudo`, pero un estado de error es un problema de la preparación de la prueba. */
export async function edge<T>(
  rol: Rol,
  funcion: FuncionEdge,
  ruta: string,
  opciones: { method?: string; body?: unknown } = {},
): Promise<T> {
  const respuesta = await edgeCrudo(rol, funcion, ruta, opciones)
  if (respuesta.status >= 400) {
    throw new Error(
      `${opciones.method ?? "GET"} ${funcion}/${ruta}: ${respuesta.status} ${respuesta.texto.slice(0, 400)}`,
    )
  }
  return respuesta.datos as T
}

/** Consulta la base local. Las pruebas la usan solo para leer lo que quedó persistido. */
export function sql(consulta: string): string {
  asegurarContenedorPermitido(CONTENEDOR_DB)
  return execFileSync(
    "docker",
    ["exec", "-i", CONTENEDOR_DB, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"],
    { input: consulta, encoding: "utf8" },
  ).trim()
}

export async function crearUsuario(rol: Rol, datos: { nombre: string; apellido: string }) {
  const cabeceras = {
    apikey: SERVICE_ROLE_JWT,
    authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    "content-type": "application/json",
  }
  const respuesta = await fetch(urlLocal("/auth/v1/admin/users"), {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({
      email: EMAIL[rol],
      password: CONTRASENA,
      email_confirm: true,
      user_metadata: datos,
    }),
  })
  const cuerpo = (await respuesta.json()) as { id?: string }
  if (!respuesta.ok || !cuerpo.id) {
    throw new Error(`No se pudo crear ${EMAIL[rol]}: ${respuesta.status}`)
  }
  return cuerpo.id
}
