import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test"

import { type VisitaProgramada } from "./datos"
import { fechaArgentina } from "./semilla"
import {
  abrirVisita,
  completarCaptura,
  estadoVisita,
  firmarCliente,
  firmarTecnico,
  guardarBorrador,
  guardarParteDiario,
  iniciarBorrador,
  iniciarVisita,
  esperarAgendaEstable,
} from "./taller"

/**
 * Espera a que el service worker controle la página y haya guardado `/taller` para abrir sin red.
 * Es solo una condición de espera: la prueba mira después lo que ve el técnico.
 */
export async function esperarServiceWorker(page: Page) {
  await expect(async () => {
    const listo = await page.evaluate(async () => {
      const registro = await navigator.serviceWorker.getRegistration()
      if (!registro?.active || !navigator.serviceWorker.controller) return false
      const nombres = await caches.keys()
      const html = nombres.find((nombre) => nombre.includes("html-taller"))
      return Boolean(html && (await (await caches.open(html)).match("/taller", { ignoreVary: true })))
    })
    if (!listo) {
      await page.reload()
      await expect(page.getByRole("heading", { name: "Mis visitas de servicio" })).toBeVisible()
    }
    expect(listo).toBe(true)
  }).toPass({ timeout: 90_000 })
}

/** Deja la visita lista para trabajar sin red: reservada en este dispositivo y agenda descargada. */
export async function prepararSinConexion(page: Page, context: BrowserContext, visitaId: string) {
  await page.goto("/taller")
  await expect(page.getByRole("heading", { name: "Mis visitas de servicio" })).toBeVisible({ timeout: 45_000 })
  await esperarServiceWorker(page)
  const tarjeta = await abrirVisita(page, visitaId)
  const reservar = tarjeta.getByRole("button", { name: "Reservar en este dispositivo" })
  await expect(reservar).toBeVisible()
  await reservar.click()
  await expect(tarjeta.getByText("Reservada localmente")).toBeVisible({ timeout: 20_000 })
  await esperarAgendaEstable(page)
  await context.setOffline(true)
  await expect(page.getByText("Trabajando offline")).toBeVisible()
  return tarjeta
}

/** Captura completa sin red: inicio, Parte Diario, certificado, firmas y cierre local. */
export async function capturarSinConexion(
  page: Page,
  tarjeta: Locator,
  visita: VisitaProgramada,
  datos: { pd: string; representante: string; fecha?: string },
) {
  await iniciarVisita(page, tarjeta)
  await guardarParteDiario(page, tarjeta, datos.pd)
  const orden = await iniciarBorrador(page, visita.valvulas[0].tag, { offline: true })
  await completarCaptura(page, orden, { fecha: datos.fecha ?? fechaArgentina() })
  await guardarBorrador(page, orden)
  await firmarClienteSinConexion(page, tarjeta, datos.representante)
  const seccion = await firmarTecnico(page, tarjeta)
  await seccion.getByRole("button", { name: "Completar visita" }).click()
  await expect(estadoVisita(page).first()).toContainText("completada localmente", { timeout: 30_000 })
  return orden
}

async function firmarClienteSinConexion(page: Page, tarjeta: Locator, nombre: string) {
  await firmarCliente(page, tarjeta, nombre)
}
