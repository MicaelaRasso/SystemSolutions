import type { Page } from "@playwright/test"

import { sql } from "../support/api"
import { elegirOpcion } from "../support/admin"
import { nombreUnico } from "../support/datos"
import { expect, test } from "../support/fixtures"

/** CUIT con dígito verificador válido, distinto en cada corrida. */
function cuitNuevo() {
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  for (;;) {
    const base = `30${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`
    const resto = [...base].reduce((suma, d, i) => suma + Number(d) * pesos[i], 0) % 11
    const verificador = resto === 0 ? 0 : 11 - resto
    if (verificador !== 10) return `${base.slice(0, 2)}-${base.slice(2)}-${verificador}`
  }
}

const dialogo = (page: Page) => page.getByRole("dialog")

async function guardarDialogo(page: Page) {
  await dialogo(page)
    .getByRole("button", { name: /^(Crear|Guardar)$/ })
    .click()
  await expect(dialogo(page)).toHaveCount(0, { timeout: 30_000 })
}

test.describe("Alta de un Cliente nuevo y carga de su estructura", () => {
  test("RF-02 RF-05: el Cliente recién invitado (cuenta pendiente) ya admite yacimiento, planta, equipo y válvula [P5]", async ({
    abrir,
  }) => {
    const { page, problemas } = await abrir("admin")
    const razonSocial = nombreUnico("Cliente Alta")
    const email = `${nombreUnico("alta").toLowerCase()}@local.test`

    await page.goto("/admin/clientes/nuevo")
    await page.getByLabel("Razón social").fill(razonSocial)
    await page.getByLabel("CUIT").fill(cuitNuevo())
    await page.getByLabel("Contacto").fill("Contacto Alta")
    await page.getByLabel("Teléfono").fill("299-555-0300")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Dirección").fill("Calle Alta 1")
    await page.getByRole("button", { name: "Crear cliente" }).click()
    await expect(page).toHaveURL(/\/admin\/clientes\/[0-9a-f-]{36}\/estructura/, {
      timeout: 45_000,
    })

    // El Cliente todavía no aceptó la invitación.
    const cuenta = page.url().match(/clientes\/([0-9a-f-]{36})/)![1]
    expect(sql(`select estado || '/' || activo from public.cuentas where id = '${cuenta}'`)).toBe(
      "pendiente/false",
    )

    const yacimiento = nombreUnico("Yac Alta")
    await page.getByRole("button", { name: "Yacimiento", exact: true }).first().click()
    await dialogo(page).getByLabel("Nombre").fill(yacimiento)
    await elegirOpcion(page, dialogo(page).locator("#provincia"), "Neuquén")
    await dialogo(page).getByLabel("Operadora").fill("Operadora Alta")
    await guardarDialogo(page)
    await expect(page.getByText(yacimiento).first()).toBeVisible()

    const planta = nombreUnico("Planta Alta")
    await page.getByRole("button", { name: "Planta", exact: true }).click()
    await dialogo(page).getByLabel("Nombre").fill(planta)
    await guardarDialogo(page)
    await page.getByText(planta).first().click()

    const equipo = nombreUnico("K-ALTA")
    await page.getByRole("button", { name: "Equipo", exact: true }).click()
    // El backend no guarda una descripción del equipo: el formulario no la ofrece.
    await expect(dialogo(page).getByLabel(/Descripción/)).toHaveCount(0)
    await dialogo(page).getByLabel("Identificación").fill(equipo)
    await guardarDialogo(page)
    await page.getByText(equipo).first().click()

    const tag = nombreUnico("PSV-ALTA")
    await page.getByRole("button", { name: "Válvula", exact: true }).click()
    await dialogo(page).getByLabel("TAG").fill(tag)
    await guardarDialogo(page)
    await expect(page.getByText(tag).first()).toBeVisible()

    expect(
      sql(`select count(*) from public.valvulas v
        join public.equipos_unidades e on e.id = v.equipo_id
        join public.plantas_locaciones p on p.id = e.planta_id
        join public.yacimientos y on y.id = p.yacimiento_id
        where y.cliente_cuenta_id = '${cuenta}'`),
    ).toBe("1")
    expect(problemas.respuestas).toEqual([])
    expect(problemas.consola).toEqual([])
  })
})
