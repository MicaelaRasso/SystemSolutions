import { sql } from "../support/api"
import { crearEquipo, nombreUnico, visitaAceptada } from "../support/datos"
import { expect, test } from "../support/fixtures"
import { prepararSinConexion } from "../support/offline"
import { PLANTA } from "../support/semilla"
import {
  abrirVisita,
  agregarValvulaExistente,
  darDeAltaValvula,
  iniciarVisita,
} from "../support/taller"

/** Válvula dada de alta en campo, con su revisión y su orden en la visita. */
const altaEnServidor = (visitaId: string, tag: string) =>
  sql(
    `select count(distinct v.id) || '/' || count(distinct r.id) || '/' || count(distinct o.id)
       from public.valvulas v
       left join public.valvula_revisiones r on r.valvula_id = v.id
       left join public.ordenes_trabajo o on o.valvula_id = v.id and o.visita_id = '${visitaId}'
      where v.nombre = '${tag}'`,
  )

/** Órdenes de la visita para una válvula, leídas de lo que quedó persistido. */
const ordenesDe = (visitaId: string, valvulaId: string) =>
  sql(
    `select count(*) from public.ordenes_trabajo where visita_id = '${visitaId}' and valvula_id = '${valvulaId}'`,
  )

test.describe("Flujo 10: válvulas agregadas en campo (A4)", () => {
  test("A1 A3: con conexión, el técnico agrega una válvula existente del catálogo del Cliente", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    // Otra válvula del mismo yacimiento que no está en la visita.
    const {
      valvulas: [extra],
    } = await crearEquipo(1)
    const { page } = await abrir("taller", { viewport: "celular" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)

    const orden = await agregarValvulaExistente(page, tarjeta, extra.tag)

    await expect(orden.getByRole("button", { name: "Evaluada", exact: true })).toBeEnabled()
    await expect(async () => expect(ordenesDe(visita.visitaId, extra.id)).toBe("1")).toPass({
      timeout: 30_000,
    })
  })

  test("A1 A3 RNF-04: sin conexión, la válvula aparece al instante y se sincroniza al reconectar sin duplicarse", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const {
      valvulas: [extra],
    } = await crearEquipo(1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await prepararSinConexion(page, context, visita.visitaId)
    await iniciarVisita(page, tarjeta)

    await test.step("sin red: el buscador usa el catálogo descargado y la orden se ve enseguida", async () => {
      await agregarValvulaExistente(page, tarjeta, extra.tag)
      await expect(tarjeta.getByText(/cambio\(s\) local\(es\)/)).toBeVisible()
      expect(ordenesDe(visita.visitaId, extra.id)).toBe("0")
    })

    await test.step("al reconectar, la orden existe en el servidor una sola vez", async () => {
      await context.setOffline(false)
      await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 45_000 })
      await expect(async () => expect(ordenesDe(visita.visitaId, extra.id)).toBe("1")).toPass({
        timeout: 90_000,
      })
      await page.reload()
      await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 45_000 })
      expect(ordenesDe(visita.visitaId, extra.id)).toBe("1")
    })
  })

  test("A2 A3: con conexión, el técnico da de alta una válvula nueva en un equipo existente", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const tag = nombreUnico("PSV-CAMPO").toUpperCase()
    const { page } = await abrir("taller", { viewport: "celular" })
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await iniciarVisita(page, tarjeta)

    await darDeAltaValvula(page, tarjeta, {
      tag,
      equipo: visita.equipo,
      planta: PLANTA,
      marca: "Crosby",
    })

    await expect(async () => expect(altaEnServidor(visita.visitaId, tag)).toBe("1/1/1")).toPass({
      timeout: 30_000,
    })
    expect(sql(`select marca from public.valvulas where nombre = '${tag}'`)).toBe("Crosby")
  })

  test("A2 A3 RNF-04: sin conexión, la válvula nueva se ve al instante y al reconectar existe una sola vez", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const tag = nombreUnico("PSV-OFF").toUpperCase()
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await prepararSinConexion(page, context, visita.visitaId)
    await iniciarVisita(page, tarjeta)

    await test.step("sin red: el alta queda en el dispositivo y la orden se puede trabajar", async () => {
      const orden = await darDeAltaValvula(page, tarjeta, {
        tag,
        equipo: visita.equipo,
        planta: PLANTA,
      })
      await expect(orden.getByRole("button", { name: "Evaluada", exact: true })).toBeEnabled()
      expect(altaEnServidor(visita.visitaId, tag)).toBe("0/0/0")
    })

    await test.step("al reconectar se crean la válvula, su revisión y la orden, sin duplicados", async () => {
      await context.setOffline(false)
      await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 45_000 })
      await expect(async () => expect(altaEnServidor(visita.visitaId, tag)).toBe("1/1/1")).toPass({
        timeout: 90_000,
      })
      await page.reload()
      await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 45_000 })
      expect(altaEnServidor(visita.visitaId, tag)).toBe("1/1/1")
    })
  })
})
