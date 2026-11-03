import { expect, type Locator, type Page } from "@playwright/test"

import { CLIENTE, fechaArgentina, PLANTA, TALLER, YACIMIENTO } from "./semilla"

export const comboTarea = (page: Page, nombre: RegExp) => page.getByRole("combobox", { name: nombre })

/** Abre un Select de Radix y elige la opción, reintentando si el clic se pierde. */
export async function elegirOpcion(page: Page, disparador: Locator, opcion: string | RegExp) {
  await expect(async () => {
    await disparador.click({ timeout: 5_000 })
    await page.getByRole("option", { name: opcion }).first().click({ timeout: 5_000 })
    await expect(disparador).toContainText(opcion, { timeout: 5_000 })
  }).toPass({ timeout: 45_000 })
}

/** La cascada autoselecciona un nivel con una sola opción: se elige solo si sigue vacío. */
async function elegirSiVacio(page: Page, disparador: Locator, opcion: string) {
  await expect(disparador).toBeEnabled({ timeout: 30_000 })
  if ((await disparador.getAttribute("data-placeholder")) !== null) {
    await elegirOpcion(page, disparador, opcion)
  }
  await expect(disparador).toContainText(opcion)
}

export async function elegirUbicacion(page: Page) {
  await elegirOpcion(page, comboTarea(page, /^Cliente/), CLIENTE)
  await elegirSiVacio(page, comboTarea(page, /^Yacimiento/), YACIMIENTO)
  await elegirSiVacio(page, comboTarea(page, /^Planta/), PLANTA)
}

export type DatosTareaUi = {
  equipo: string
  pdRto?: string
  ordenTrabajo?: string
  contacto?: string
  telefono?: string
  detalle?: string
  horario?: string
  fecha?: string
  conTaller?: boolean
}

export async function completarDatosTarea(page: Page, datos: Omit<DatosTareaUi, "equipo">) {
  await page.locator('input[name="horario"]').fill(datos.horario ?? "09:30")
  if (datos.conTaller !== false) {
    await elegirOpcion(page, comboTarea(page, /^Taller/), TALLER)
  }
  await page.locator('input[name="contacto"]').fill(datos.contacto ?? "Pedro Contacto")
  await page.locator('input[name="telefono"]').fill(datos.telefono ?? "299-555-0199")
  await page.locator('input[name="ordenTrabajo"]').fill(datos.ordenTrabajo ?? "")
  await page.locator('input[name="pdRto"]').fill(datos.pdRto ?? "")
  await page.locator("#detalle").fill(datos.detalle ?? "Calibración anual")
}

/** Crea la tarea por `/admin/tareas/nueva` y devuelve el id de la visita creada. */
export async function crearTareaPorPantalla(page: Page, datos: DatosTareaUi) {
  await page.goto(`/admin/tareas/nueva?fecha=${datos.fecha ?? fechaArgentina()}`)
  await elegirUbicacion(page)
  await elegirOpcion(page, comboTarea(page, /^Equipo/), datos.equipo)
  await completarDatosTarea(page, datos)
  await page.getByRole("button", { name: "Crear tarea" }).click()
  await expect(page).toHaveURL(/\/admin\/tareas\/[0-9a-f-]{36}/, { timeout: 45_000 })
  return page.url().split("/").pop()!.split("?")[0]
}

/** Vista previa de un certificado para el rol dado. */
export const vistaCertificado = (page: Page) => page.getByRole("region", { name: "Vista del certificado" })
