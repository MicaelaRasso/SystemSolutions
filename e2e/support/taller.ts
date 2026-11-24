import { expect, type Locator, type Page } from "@playwright/test"

import { fechaArgentina, TECNICO } from "./semilla"

/** PNG mínimo válido (10x10), suficiente para fotos y firmas de prueba. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC",
  "base64",
)

export const archivoPng = (name: string) => ({ name, mimeType: "image/png", buffer: PNG })

export const REGEX_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Tarjeta de una visita en `/taller`, ubicada por el id que expone su título. */
export const tarjetaVisita = (page: Page, visitaId: string) =>
  page.locator(`[data-visit-id="${visitaId}"]`).locator('xpath=ancestor::div[@data-slot="card"][1]')

/** Tarjeta de la Orden de trabajo de una válvula. */
export const tarjetaOrden = (page: Page, tag: string) =>
  page
    .locator('[data-slot="card-title"]', { hasText: new RegExp(`V[aá]lvula ${tag}`) })
    .locator('xpath=ancestor::div[@data-slot="card"][1]')

export const estadoVisita = (page: Page) => page.getByRole("status")

export async function abrirVisita(page: Page, visitaId: string) {
  await page.goto("/taller")
  const tarjeta = tarjetaVisita(page, visitaId)
  await expect(tarjeta).toBeVisible({ timeout: 45_000 })
  await expect(async () => {
    const cerrar = tarjeta.getByRole("button", { name: "Cerrar visita" })
    if (!(await cerrar.isVisible())) {
      await tarjeta.getByRole("button", { name: "Abrir visita" }).click({ timeout: 5_000 })
    }
    await expect(cerrar).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 45_000 })
  return tarjeta
}

/** Reserva la visita en este dispositivo y la inicia. Hace falta estar con conexión o catálogos. */
export async function iniciarVisita(page: Page, tarjeta: Locator) {
  const reservar = tarjeta.getByRole("button", { name: "Reservar en este dispositivo" })
  if (await reservar.isVisible()) {
    await reservar.click()
    await expect(tarjeta.getByText("Reservada localmente")).toBeVisible()
  }
  const parteDiario = tarjeta.getByText("Parte Diario (Facturación)")
  await expect(async () => {
    if (!(await parteDiario.isVisible())) {
      await tarjeta.getByRole("button", { name: "Iniciar Visita de servicio" }).click({ timeout: 5_000 })
    }
    await expect(parteDiario).toBeVisible({ timeout: 8_000 })
  }).toPass({ timeout: 45_000 })
}

/** Marca la orden como evaluada y deja abierto el borrador de certificado. */
export async function iniciarBorrador(page: Page, tag: string, opciones: { offline?: boolean } = {}) {
  const orden = tarjetaOrden(page, tag)
  // El formulario se vuelve a montar cuando llega el borrador del servidor y descarta lo escrito
  // antes: con conexión hay que esperar esa respuesta para empezar a completar.
  const borradorCargado = opciones.offline
    ? Promise.resolve()
    : page.waitForResponse(
        (respuesta) =>
          respuesta.request().method() === "GET" &&
          /\/certificates\/[0-9a-f-]{36}$/.test(new URL(respuesta.url()).pathname),
        { timeout: 90_000 },
      )
  await expect(async () => {
    await orden.getByRole("button", { name: "Evaluada", exact: true }).click({ timeout: 5_000 })
    await expect(orden.getByText("Estado: Evaluada", { exact: true })).toBeVisible({ timeout: 8_000 })
  }).toPass({ timeout: 45_000 })
  const fecha = orden.locator('[id="certificate-execution-date"]')
  await expect(async () => {
    if (!(await fecha.isVisible())) {
      await orden.getByRole("button", { name: /Iniciar Borrador de certificado/ }).click({ timeout: 5_000 })
    }
    await expect(fecha).toBeVisible({ timeout: 10_000 })
  }).toPass({ timeout: 60_000 })
  await borradorCargado
  await expect(fecha).toBeVisible()
  return orden
}

/** Elige una opción de un Select de Radix y comprueba que quedó elegida. */
async function elegirEnDesplegable(page: Page, orden: Locator, id: string, indice: number) {
  const disparador = orden.locator(`[id="${id}"]`)
  const opciones = page.locator('[role="listbox"] [role="option"]')
  let elegida = ""
  await expect(async () => {
    await disparador.click({ timeout: 5_000 })
    await expect(opciones.nth(indice)).toBeVisible({ timeout: 5_000 })
    elegida = (await opciones.nth(indice).innerText()).trim()
    await opciones.nth(indice).click({ timeout: 5_000 })
    await expect(disparador).toContainText(elegida, { timeout: 5_000 })
  }).toPass({ timeout: 45_000 })
  return elegida
}

export type DatosCaptura = {
  fecha?: string
  /** Texto del desplegable «Otros» de repuestos. Vacío a propósito por defecto. */
  otros?: string
  /** Fotos por sección; `false` deja la captura sin evidencia. */
  fotos?: boolean
  tecnico?: string
}

export const VALORES_TECNICOS = {
  precinto: "PR-1001",
  servicio: "GAS COMBUSTIBLE",
  marca: "Farris",
  numero_serie: "SN-777",
  modelo: "2600",
  pv: "GAS",
  presion_operacion: "12.5",
  temperatura_operacion: "45",
} as const

/** Elige el técnico con su nombre completo de nómina (el desplegable omite el apellido, D3). */
async function escribirTecnico(orden: Locator, nombre: string) {
  const selector = orden.locator('[id="certificate-technician"]')
  if ((await selector.evaluate((elemento) => elemento.tagName)) === "INPUT") {
    await selector.fill(nombre)
    return
  }
  await selector.selectOption("__otro__")
  await orden.locator('[id="certificate-technician-custom"]').fill(nombre)
}

/** Completa la captura de una válvula: 13 datos técnicos, ensayos, mantenimiento y fotos. */
export async function completarCaptura(page: Page, orden: Locator, datos: DatosCaptura = {}) {
  const campo = (id: string) => orden.locator(`[id="${id}"]`)
  await campo("certificate-execution-date").fill(datos.fecha ?? fechaArgentina())
  await escribirTecnico(orden, datos.tecnico ?? TECNICO.completo)

  for (const [clave, valor] of Object.entries(VALORES_TECNICOS)) {
    await campo(`certificate-technical-${clave}`).fill(valor)
  }
  const elegidas = {
    tipo: await elegirEnDesplegable(page, orden, "certificate-technical-tipo", 0),
    rosca: await elegirEnDesplegable(page, orden, "certificate-technical-rosca", 0),
    entrada: await elegirEnDesplegable(page, orden, "certificate-technical-diametro_entrada", 2),
    salida: await elegirEnDesplegable(page, orden, "certificate-technical-diametro_salida", 3),
  }

  let valor = 10
  for (const clave of ["sp_inicial", "sp_apertura", "presion_cierre"]) {
    const ensayo = campo(`certificate-test-${clave}`)
    await ensayo.fill(String(valor))
    await ensayo.locator("xpath=following-sibling::select").selectOption({ index: 1 })
    valor += 1
  }
  await campo("certificate-standard").selectOption({ index: 1 })

  const casillas = orden.getByRole("checkbox")
  await casillas.nth(0).click()
  await expect(casillas.nth(0)).toBeChecked()
  await casillas.nth(1).click()
  await casillas.nth(12).click()
  await expect(casillas.nth(12)).toBeChecked()
  if (datos.otros) await campo("certificate-other-parts").fill(datos.otros)
  await orden.getByPlaceholder("Observaciones del campo").fill("Sin novedades en el ensayo")

  if (datos.fotos !== false) {
    const entradas = orden.locator('input[type="file"]')
    await expect(entradas).toHaveCount(3)
    for (const [i, nombre] of ["desarmada.png", "ensamblada.png", "placa.png"].entries()) {
      await entradas.nth(i).setInputFiles(archivoPng(nombre))
      await expect(estadoVisita(page).first()).toContainText("guardada localmente")
    }
  }
  return elegidas
}

export async function guardarBorrador(page: Page, orden: Locator) {
  await expect(async () => {
    await orden.getByRole("button", { name: "Guardar Borrador de certificado" }).click({ timeout: 5_000 })
    await expect(estadoVisita(page).first()).toContainText("Borrador guardado", { timeout: 15_000 })
  }).toPass({ timeout: 60_000 })
}

export async function marcarNoEvaluada(page: Page, tag: string, motivo: string) {
  const orden = tarjetaOrden(page, tag)
  await orden.getByRole("button", { name: "No evaluada", exact: true }).click()
  await orden.getByPlaceholder("Motivo si no fue evaluada").fill(motivo)
  await expect(async () => {
    await orden.getByRole("button", { name: "Confirmar no evaluada" }).click({ timeout: 5_000 })
    await expect(orden.getByText("Estado: No evaluada")).toBeVisible({ timeout: 8_000 })
  }).toPass({ timeout: 45_000 })
}

export async function guardarParteDiario(page: Page, tarjeta: Locator, codigo: string, foto = true) {
  await tarjeta.locator('input[id^="parte-diario-code-"]').fill(codigo)
  await tarjeta.getByRole("button", { name: "Guardar número PD" }).click()
  await expect(tarjeta.getByText(`PD ${codigo}`, { exact: false }).first()).toBeVisible()
  if (foto) {
    await tarjeta.locator('input[id^="parte-diario-photo-"]').setInputFiles(archivoPng("parte.png"))
    await expect(tarjeta.getByText(/1 foto\(s\)/)).toBeVisible({ timeout: 30_000 })
  }
}

/**
 * Cada cambio refresca la agenda en segundo plano, y `visitas-panel.tsx:262` reordena las tarjetas
 * por `cachedAt`: mover la tarjeta abierta corta el trazo de una firma y salta el scroll (defecto
 * N1 en `e2e/README.md`). Un técnico puede quedar en esa ventana; acá se la espera para que la
 * prueba de la firma sea determinista.
 */
export async function esperarAgendaEstable(page: Page) {
  await page.waitForLoadState("networkidle")
  // Sin red no hay refresco que esperar y el indicador nunca dice «Conectado» (flujo 3).
  if (await page.evaluate(() => navigator.onLine)) {
    await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState("networkidle")
  }
}

/**
 * Dibuja un trazo real sobre el lienzo de firma. Chromium headless a veces descarta el puntero:
 * «Limpiar» se habilita recién cuando el lienzo tiene tinta, así que se reintenta hasta verlo.
 */
export async function dibujarFirma(page: Page, seccion: Locator) {
  const lienzo = seccion.locator("canvas").first()
  const limpiar = seccion.getByRole("button", { name: "Limpiar" })
  await expect(async () => {
    await lienzo.scrollIntoViewIfNeeded()
    const caja = await lienzo.boundingBox()
    if (!caja) throw new Error("El lienzo de firma no tiene tamaño")
    const y = caja.y + caja.height / 2
    await page.mouse.move(caja.x + 20, y)
    await page.mouse.down()
    for (let i = 1; i <= 12; i += 1) {
      await page.mouse.move(caja.x + 20 + i * 15, y + (i % 2 ? 25 : -25), { steps: 3 })
    }
    await page.mouse.up()
    await expect(limpiar).toBeEnabled({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

export const seccionFirmaCliente = (tarjeta: Locator) =>
  tarjeta.locator('section[aria-label="Firma del Cliente"]')
export const seccionFirmaTecnico = (tarjeta: Locator) =>
  tarjeta.locator('section[aria-label="Firma del Técnico"]')

export async function firmarCliente(page: Page, tarjeta: Locator, nombre: string) {
  const seccion = seccionFirmaCliente(tarjeta)
  await seccion.getByPlaceholder("Nombre y apellido").fill(nombre)
  await esperarAgendaEstable(page)
  await dibujarFirma(page, seccion)
  await seccion.getByRole("button", { name: /Registrar firma del Cliente/ }).click()
  await expect(tarjeta.getByText(`Firma presencial registrada para ${nombre}`)).toBeVisible({
    timeout: 30_000,
  })
}

export async function omitirFirmaCliente(tarjeta: Locator) {
  await seccionFirmaCliente(tarjeta).getByRole("button", { name: /No hay representante/ }).click()
  await expect(seccionFirmaTecnico(tarjeta)).toBeVisible()
}

/**
 * Firma del técnico con su nombre completo de nómina por «Otro técnico», el camino que la app
 * ofrece y que aísla D3. Luego queda listo para completar o cerrar como no terminada.
 */
export async function firmarTecnico(page: Page, tarjeta: Locator, nombre = TECNICO.completo) {
  const seccion = seccionFirmaTecnico(tarjeta)
  await seccion.locator("select").first().selectOption("__otro__")
  await seccion.getByPlaceholder(/reemplazante/).fill(nombre)
  await esperarAgendaEstable(page)
  await dibujarFirma(page, seccion)
  return seccion
}

export type CierreVisita = {
  /** Nombre del representante; sin él, la visita queda pendiente de firma del Cliente. */
  representante?: string
  fecha?: string
  /** Código de Parte Diario de la visita; sin foto. */
  pd?: string
}

/** Recorre una visita de una válvula con conexión, de punta a punta, para preparar otras pruebas. */
export async function capturarYCerrar(page: Page, visitaId: string, tag: string, cierre: CierreVisita = {}) {
  const tarjeta = await abrirVisita(page, visitaId)
  await iniciarVisita(page, tarjeta)
  if (cierre.pd) await guardarParteDiario(page, tarjeta, cierre.pd, false)
  const orden = await iniciarBorrador(page, tag)
  await completarCaptura(page, orden, { fecha: cierre.fecha })
  await guardarBorrador(page, orden)
  await esperarAgendaEstable(page)
  if (cierre.representante) await firmarCliente(page, tarjeta, cierre.representante)
  else await omitirFirmaCliente(tarjeta)
  const seccion = await firmarTecnico(page, tarjeta)
  await completarVisita(page, seccion)
  await expect(estadoVisita(page).first()).toContainText("Visita completada", { timeout: 30_000 })
  return tarjeta
}

/** Pulsa «Completar visita» y confirma el diálogo de confirmación (el cierre es irreversible). */
export async function completarVisita(page: Page, seccion: Locator) {
  await seccion.getByRole("button", { name: "Completar visita" }).click()
  const dialogo = page.getByRole("alertdialog")
  await expect(dialogo).toBeVisible()
  await dialogo.getByRole("button", { name: "Completar visita" }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
}


/** Diálogo «Agregar válvula» de la visita (A1/A3). */
export const dialogoAgregarValvula = (page: Page) => page.getByRole("dialog", { name: "Agregar válvula" })

/** Busca una válvula del catálogo del Cliente y la agrega a la visita en curso. */
export async function agregarValvulaExistente(page: Page, tarjeta: Locator, tag: string) {
  await tarjeta.getByRole("button", { name: "Agregar válvula" }).click()
  const dialogo = dialogoAgregarValvula(page)
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel("Buscar en el catálogo").fill(tag)
  await dialogo.getByRole("button", { name: `Agregar ${tag}` }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  await expect(tarjetaOrden(page, tag)).toBeVisible({ timeout: 30_000 })
  return tarjetaOrden(page, tag)
}

/** Da de alta una válvula nueva en un equipo existente desde la visita en curso (A2/A3). */
export async function darDeAltaValvula(
  page: Page,
  tarjeta: Locator,
  datos: { tag: string; equipo: string; planta: string; marca?: string },
) {
  await tarjeta.getByRole("button", { name: "Agregar válvula" }).click()
  const dialogo = dialogoAgregarValvula(page)
  await expect(dialogo).toBeVisible()
  await dialogo.getByRole("tab", { name: "Nueva válvula" }).click()
  await dialogo.getByLabel("Equipo").selectOption({ label: `${datos.equipo} · ${datos.planta}` })
  await dialogo.getByLabel("TAG").fill(datos.tag)
  if (datos.marca) await dialogo.getByLabel("Marca").fill(datos.marca)
  await dialogo.getByRole("button", { name: "Crear" }).click()
  await expect(dialogo).toBeHidden({ timeout: 30_000 })
  await expect(tarjetaOrden(page, datos.tag)).toBeVisible({ timeout: 30_000 })
  return tarjetaOrden(page, datos.tag)
}
