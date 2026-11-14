import type { Rol } from "../support/api"
import { expect, test, type Viewport } from "../support/fixtures"

const ROLES: Rol[] = ["super", "admin", "taller", "cliente"]
const INICIO: Record<Rol, string> = {
  super: "/admin",
  admin: "/admin",
  taller: "/taller",
  cliente: "/portal",
  cliente2: "/portal",
}

test.describe("Botón de instalación de la app", () => {
  for (const rol of ROLES) {
    for (const viewport of ["escritorio", "celular"] as Viewport[]) {
      test(`RF-18 RNF-06: ${rol} ve el botón «Instalar app» en ${viewport} y abre las instrucciones`, async ({ abrir }) => {
        const { page, context } = await abrir(rol, { viewport, iniciarSesion: false })
        // Chromium dispara el aviso nativo solo a veces: se lo oculta para probar siempre lo mismo.
        await context.addInitScript(() => {
          window.addEventListener(
            "beforeinstallprompt",
            (evento) => {
              if (evento.isTrusted) evento.stopImmediatePropagation()
            },
            true,
          )
        })
        const { iniciarSesion } = await import("../support/fixtures")
        await iniciarSesion(page, rol)
        await page.goto(INICIO[rol])
        const boton = page.getByRole("button", { name: "Instalar app" })
        await expect(boton).toBeVisible({ timeout: 45_000 })
        await boton.click()
        await expect(page.getByRole("dialog").getByText(/Instalar app|Agregar a/).first()).toBeVisible()
      })
    }
  }
})

const PANTALLAS: Record<Exclude<Rol, "cliente2">, string[]> = {
  admin: [
    "/admin",
    "/admin/agenda",
    "/admin/cronograma",
    "/admin/tareas",
    "/admin/tareas/nueva",
    "/admin/certificados",
    "/admin/auditoria",
    "/admin/clientes",
    "/admin/talleres",
    "/admin/catalogos",
    "/admin/configuracion/certificado",
    "/cuenta/seguridad",
  ],
  super: ["/superadmin", "/superadmin/administradores", "/superadmin/backups"],
  taller: ["/taller", "/taller/sincronizacion"],
  cliente: ["/portal", "/portal/turnos", "/portal/certificados", "/portal/empresa"],
}

test.describe("Ancho de celular (390 px)", () => {
  for (const [rol, rutas] of Object.entries(PANTALLAS) as [Rol, string[]][]) {
    for (const ruta of rutas) {
      test(`RNF-06 RF-33 RF-35: ${ruta} carga a 390 px sin scroll horizontal ni errores de consola (${rol})`, async ({
        abrir,
      }) => {
        const { page, problemas } = await abrir(rol, { viewport: "celular" })
        const respuesta = await page.goto(ruta)
        expect(respuesta?.status()).toBeLessThan(400)
        await page.waitForLoadState("networkidle")
        await expect(page.getByText(/Application error|No se pudo cargar|respuesta inválida/)).toHaveCount(0)
        const { ancho, contenido } = await page.evaluate(() => ({
          ancho: document.documentElement.clientWidth,
          contenido: document.documentElement.scrollWidth,
        }))
        expect(contenido).toBeLessThanOrEqual(ancho)
        expect(problemas.consola).toEqual([])
      })
    }
  }
})
