import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test as base,
  type TestInfo,
} from "@playwright/test"

import { CONTRASENA, EMAIL, type Rol } from "./api"
import { BASE_URL } from "./entorno"

export const VIEWPORTS = {
  escritorio: { width: 1366, height: 900 },
  tablet: { width: 820, height: 1180 },
  celular: { width: 390, height: 844 },
} as const
export type Viewport = keyof typeof VIEWPORTS

export type Problemas = {
  consola: string[]
  respuestas: { status: number; metodo: string; url: string }[]
  hostsBloqueados: string[]
}

export type Sesion = { context: BrowserContext; page: Page; problemas: Problemas }

export type OpcionesSesion = {
  viewport?: Viewport
  /** `false` abre el contexto sin iniciar sesión. */
  iniciarSesion?: boolean
}

const HOSTS_LOCALES = new Set(["127.0.0.1", "localhost"])

/**
 * Barrera de red de toda la suite: aborta lo que no vaya a esta máquina y lo registra. Un host
 * `supabase.co` hace fallar la prueba aunque el flujo haya terminado bien (ver `abrir`).
 */
export async function protegerContexto(context: BrowserContext, problemas: Problemas) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.protocol === "data:" || url.protocol === "blob:" || HOSTS_LOCALES.has(url.hostname)) {
      return route.continue()
    }
    problemas.hostsBloqueados.push(url.hostname)
    return route.abort()
  })
}

function observarPagina(page: Page, problemas: Problemas) {
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error") problemas.consola.push(mensaje.text().slice(0, 300))
  })
  page.on("pageerror", (error) => problemas.consola.push(`pageerror: ${String(error).slice(0, 300)}`))
  page.on("response", (respuesta) => {
    if (respuesta.status() >= 400) {
      problemas.respuestas.push({
        status: respuesta.status(),
        metodo: respuesta.request().method(),
        url: respuesta.url(),
      })
    }
  })
}

/** Inicia sesión por la pantalla real. Reintenta porque Chromium headless a veces descarta un clic. */
export async function iniciarSesion(page: Page, rol: Rol) {
  await page.goto("/login")
  const email = page.locator('input[type="email"]')
  const contrasena = page.locator('input[type="password"]')
  await expect(async () => {
    await email.fill(EMAIL[rol])
    await contrasena.fill(CONTRASENA)
    await page.getByRole("button", { name: "Ingresar" }).click({ timeout: 5_000 })
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  }).toPass({ timeout: 60_000 })
}

async function crearSesion(
  browser: Browser,
  rol: Rol,
  opciones: OpcionesSesion,
  abiertas: Sesion[],
): Promise<Sesion> {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: VIEWPORTS[opciones.viewport ?? "escritorio"],
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    acceptDownloads: true,
  })
  const problemas: Problemas = { consola: [], respuestas: [], hostsBloqueados: [] }
  await protegerContexto(context, problemas)
  const page = await context.newPage()
  observarPagina(page, problemas)
  context.on("page", (nueva) => observarPagina(nueva, problemas))
  const sesion = { context, page, problemas }
  abiertas.push(sesion)
  if (opciones.iniciarSesion !== false) await iniciarSesion(page, rol)
  return sesion
}

function verificarHostsRemotos(abiertas: Sesion[], info: TestInfo) {
  const hosts = [...new Set(abiertas.flatMap((sesion) => sesion.problemas.hostsBloqueados))]
  if (hosts.length) {
    info.annotations.push({ type: "hosts-bloqueados", description: hosts.join(", ") })
  }
  const remotos = hosts.filter((host) => host.endsWith("supabase.co"))
  if (remotos.length) {
    throw new Error(`Seguridad E2E: el navegador intentó llegar a ${remotos.join(", ")}`)
  }
}

export const test = base.extend<{
  abrir: (rol: Rol, opciones?: OpcionesSesion) => Promise<Sesion>
}>({
  abrir: async ({ browser }, use, info) => {
    const abiertas: Sesion[] = []
    await use((rol, opciones = {}) => crearSesion(browser, rol, opciones, abiertas))
    await Promise.all(abiertas.map((sesion) => sesion.context.close().catch(() => undefined)))
    verificarHostsRemotos(abiertas, info)
  },
})

export { expect }
