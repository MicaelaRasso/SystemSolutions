import { afterEach, describe, expect, it, vi } from "vitest"

import { esUrlLocal } from "../../e2e/support/entorno"

const URL_REMOTA = "https://proyecto-real.supabase.co"
const variablesOriginales = { ...process.env }

afterEach(() => {
  process.env = { ...variablesOriginales }
  vi.restoreAllMocks()
  vi.resetModules()
})

/** Importa el cargador de cero, con las variables de entorno que haya en ese momento. */
async function cargadorCon(variables: Record<string, string>) {
  vi.resetModules()
  Object.assign(process.env, variables)
  return import("./cargar")
}

describe("destino de los datos de demo", () => {
  it("solo acepta http en 127.0.0.1 o localhost con puerto", () => {
    expect(esUrlLocal("http://127.0.0.1:55321")).toBe(true)
    expect(esUrlLocal("http://localhost:54321/")).toBe(true)
    expect(esUrlLocal(URL_REMOTA)).toBe(false)
    expect(esUrlLocal("http://proyecto.supabase.co:443")).toBe(false)
    expect(esUrlLocal("https://127.0.0.1:55321")).toBe(false)
    // Empiezan como una URL local, pero el host real es remoto.
    expect(esUrlLocal("http://127.0.0.1:x@proyecto.supabase.co")).toBe(false)
    expect(esUrlLocal("http://localhost:55321@proyecto.supabase.co/")).toBe(false)
    expect(esUrlLocal("http://127.0.0.1.proyecto.supabase.co:80")).toBe(false)
    expect(esUrlLocal("no es una url")).toBe(false)
  })

  it("se niega a cargar contra una URL remota sin hacer ningún pedido", async () => {
    const pedidos = vi.spyOn(globalThis, "fetch")
    const { cargarDatosDemo } = await cargadorCon({ E2E_SUPABASE_URL: URL_REMOTA })

    await expect(cargarDatosDemo()).rejects.toThrow(/Seguridad E2E: E2E_SUPABASE_URL/)
    expect(pedidos).not.toHaveBeenCalled()
  })

  it("se niega si la URL local esconde un host remoto o el contenedor no es de este proyecto", async () => {
    const pedidos = vi.spyOn(globalThis, "fetch")
    const disfrazada = await cargadorCon({
      E2E_SUPABASE_URL: "http://127.0.0.1:x@proyecto-real.supabase.co",
    })
    await expect(disfrazada.cargarDatosDemo()).rejects.toThrow(/Seguridad E2E/)

    const ajeno = await cargadorCon({
      E2E_SUPABASE_URL: "http://127.0.0.1:55321",
      E2E_DB_CONTAINER: "supabase_db_evopadel",
    })
    await expect(ajeno.cargarDatosDemo()).rejects.toThrow(/contenedor de base no permitido/)
    expect(pedidos).not.toHaveBeenCalled()
  })

  it("no toma la URL de la app (.env / .env.local): sin E2E_SUPABASE_URL usa el stack local", async () => {
    delete process.env.E2E_SUPABASE_URL
    const { DESTINO_POR_DEFECTO } = await (async () => {
      vi.resetModules()
      process.env.NEXT_PUBLIC_SUPABASE_URL = URL_REMOTA
      process.env.SUPABASE_URL = URL_REMOTA
      return import("./destino")
    })()

    expect(DESTINO_POR_DEFECTO.url).toBe("http://127.0.0.1:55321")
  })
})
