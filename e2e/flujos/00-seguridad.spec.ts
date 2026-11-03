import { asegurarContenedorPermitido, asegurarUrlLocal, SUPABASE_URL } from "../support/entorno"
import { expect, test } from "../support/fixtures"

test.describe("Barreras de seguridad de la suite", () => {
  test("RNF-02: la suite rechaza una URL de Supabase que no sea local", () => {
    expect(() => asegurarUrlLocal("https://abc.supabase.co")).toThrow(/Seguridad E2E/)
    expect(() => asegurarUrlLocal(SUPABASE_URL)).not.toThrow()
  })

  test("RNF-02: la suite rechaza contenedores de otro proyecto", () => {
    expect(() => asegurarContenedorPermitido("supabase_db_evopadel")).toThrow(/Seguridad E2E/)
  })

  test("RNF-02: el navegador no llega a hosts remotos y lo informa", async ({ abrir }) => {
    const { page, problemas } = await abrir("admin", { iniciarSesion: false })
    await page.goto("/login")
    const salida = await page.evaluate(() =>
      fetch("https://ejemplo-remoto.invalid/").then(
        () => "llegó",
        () => "bloqueado",
      ),
    )
    expect(salida).toBe("bloqueado")
    expect(problemas.hostsBloqueados).toContain("ejemplo-remoto.invalid")
  })
})

test.describe("RF-01: inicio de sesión", () => {
  for (const [rol, destino] of [
    // RUTA_INICIO lleva al Súper Administrador al panel común; /superadmin es una sección más.
    ["super", /\/admin/],
    ["admin", /\/admin/],
    ["taller", /\/taller/],
    ["cliente", /\/portal/],
  ] as const) {
    test(`RF-01 RNF-03: ${rol} entra por el login único y ve su panel`, async ({ abrir }) => {
      const { page } = await abrir(rol)
      await expect(page).toHaveURL(destino)
    })
  }
})
