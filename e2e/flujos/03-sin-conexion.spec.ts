import { vistaCertificado } from "../support/admin"
import { sql } from "../support/api"
import { certificadoDeValvula, visitaAceptada } from "../support/datos"
import { expect, test } from "../support/fixtures"
import { capturarSinConexion, esperarServiceWorker, prepararSinConexion } from "../support/offline"
import { fechaArgentina } from "../support/semilla"
import { abrirVisita, tarjetaOrden, tarjetaVisita } from "../support/taller"

test.describe("Flujo 3: trabajo sin conexión", () => {
  test("RF-18 RF-19 CA-02: /taller se recarga sin red y la agenda sigue disponible (D9)", async ({ abrir }) => {
    const visita = await visitaAceptada(1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    await page.goto("/taller")
    await expect(page.getByRole("heading", { name: "Mis visitas de servicio" })).toBeVisible({ timeout: 45_000 })
    await esperarServiceWorker(page)
    await expect(tarjetaVisita(page, visita.visitaId)).toBeVisible({ timeout: 45_000 })

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByRole("heading", { name: "Mis visitas de servicio" })).toBeVisible()
    await expect(page.getByText("Trabajando offline")).toBeVisible()
    await expect(tarjetaVisita(page, visita.visitaId)).toBeVisible()
    await expect(tarjetaVisita(page, visita.visitaId).getByRole("button", { name: "Abrir visita" })).toBeEnabled()
    await context.setOffline(false)
  })

  test("RF-18 RF-19: sin red, una visita aceptada abre con su número de solicitud como referencia", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await prepararSinConexion(page, context, visita.visitaId)
    await expect(tarjeta.getByText(visita.valvulas[0].tag).first()).toBeVisible()
    const numero = sql(
      `select s.numero_solicitud from public.solicitudes_servicio s where s.id = '${visita.solicitudId}'`,
    )
    await expect(tarjeta).toContainText(numero, { timeout: 5_000 })
  })

  test("RF-18 RF-21 RF-22 RF-25 RNF-04 RN-08 RN-12 CA-02 CA-04: captura, firma y cierre sin red; al reconectar se sincroniza y se emite el número", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const [valvula] = visita.valvulas
    const fechaReal = fechaArgentina(-1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await prepararSinConexion(page, context, visita.visitaId)

    await test.step("sin red: desplegables disponibles, captura y cierre local", async () => {
      await capturarSinConexion(page, tarjeta, visita, {
        pd: "7777",
        representante: "Juan Pérez",
        fecha: fechaReal,
      })
    })

    await test.step("los borradores quedan bloqueados y hay cambios pendientes", async () => {
      // Con la visita cerrada, el botón del borrador se rotula «Certificado cerrado» y queda deshabilitado.
      await expect(tarjetaOrden(page, valvula.tag).getByRole("button", { name: "Certificado cerrado" })).toBeDisabled()
      await expect(tarjeta.getByText(/Los borradores están cerrados/)).toBeVisible()
      // Exacto: el aviso «Visita completada localmente; …» también contiene el texto de la insignia.
      await expect(tarjeta.getByText("Completada localmente", { exact: true })).toBeVisible()
      // RN-12: mientras no llegue al servidor no hay certificado ni número.
      expect(sql(`select count(*) from public.certificados where visita_id = '${visita.visitaId}'`)).toBe("0")
    })

    await test.step("al reconectar, la agenda sincroniza sola y la visita queda completada", async () => {
      await context.setOffline(false)
      await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 45_000 })
      await expect(async () => {
        expect(sql(`select estado from public.visitas_servicio where id = '${visita.visitaId}'`)).toBe("completada")
      }).toPass({ timeout: 90_000 })
    })

    const certificadoId = certificadoDeValvula(visita.visitaId, valvula.id)

    await test.step("el Administrador ve el certificado emitido con la fecha real de ejecución", async () => {
      const { page: admin } = await abrir("admin")
      await admin.goto(`/admin/certificados/${certificadoId}`)
      const vista = vistaCertificado(admin)
      await expect(vista).toBeVisible({ timeout: 45_000 })
      const texto = await vista.innerText()
      expect(texto).toMatch(/CERTIFICADO #:\s*\d{2}-\d{2}-\d{4}/)
      const [anio, mes, dia] = fechaReal.split("-")
      expect(texto).toContain(`FECHA EJECUCIÓN:\n${dia}-${mes}-${anio.slice(2)}`)
    })

    // RNF-04: reintentar la sincronización no duplica certificado ni número.
    await page.reload()
    await expect(page.getByText("Conectado", { exact: true })).toBeVisible({ timeout: 45_000 })
    expect(sql(`select count(*) from public.certificados where visita_id = '${visita.visitaId}'`)).toBe("1")
  })

  test("RNF-07 RF-20 CA-02: /taller/sincronizacion sube fotos y firmas pendientes al reconectar [D8]", async ({
    abrir,
  }) => {
    const visita = await visitaAceptada(1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    const tarjeta = await prepararSinConexion(page, context, visita.visitaId)
    await capturarSinConexion(page, tarjeta, visita, { pd: "7778", representante: "Juan Pérez" })

    await page.goto("/taller/sincronizacion")
    await expect(page.getByRole("button", { name: "Actualizar ahora" })).toBeVisible()
    await context.setOffline(false)
    await expect(page.getByRole("button", { name: "Actualizar ahora" })).toBeEnabled({ timeout: 45_000 })
    await page.getByRole("button", { name: "Actualizar ahora" }).click()
    await expect(async () => {
      expect(sql(`select estado from public.visitas_servicio where id = '${visita.visitaId}'`)).toBe("completada")
    }).toPass({ timeout: 30_000 })
  })

  test("RF-18: una visita sin reservar no se puede iniciar en otro dispositivo sin conexión", async ({ abrir }) => {
    const visita = await visitaAceptada(1)
    const { page, context } = await abrir("taller", { viewport: "tablet" })
    await page.goto("/taller")
    const tarjeta = await abrirVisita(page, visita.visitaId)
    await expect(tarjeta.getByRole("button", { name: "Reservar en este dispositivo" })).toBeVisible()
    await context.setOffline(true)
    await tarjeta.getByRole("button", { name: "Reservar en este dispositivo" }).click()
    await expect(tarjeta.getByText("Reservada localmente")).toHaveCount(0)
    await context.setOffline(false)
  })
})
