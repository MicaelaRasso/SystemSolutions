import { describe, expect, it, vi } from "vitest"

import { createAdminApi } from "./admin"
import type { EdgeAccessClient } from "../services/edge"

const clientDto = {
  id: "cliente-1",
  razon_social: "Cliente Uno",
  cuit: "",
  contacto: "",
  telefono: "",
  email: "",
  direccion: "",
  logo_url: "https://storage.test/signed-logo",
  aviso_vencimiento: true,
  activo: true,
  creado_en: "2026-09-30T00:00:00Z",
  yacimientos: 0,
  valvulas: 0,
  usuarios: 1,
}

describe("Cliente logo API mapping", () => {
  it("passes the signed logo URL to existing logo consumers", async () => {
    const request = vi.fn().mockResolvedValue(clientDto)
    const api = createAdminApi({ request } as unknown as EdgeAccessClient)

    await expect(api.clients.get("cliente-1")).resolves.toMatchObject({
      id: "cliente-1",
      logoUrl: "https://storage.test/signed-logo",
    })
  })

  it("P8: serves a logo signed with the internal local Storage host from the public Supabase URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55321")
    try {
      const local = {
        ...clientDto,
        logo_url: "http://kong:8000/storage/v1/object/sign/client-logos/clients/c1/logo.png?token=t",
      }
      const request = vi.fn().mockResolvedValueOnce(local).mockResolvedValueOnce([local])
      const api = createAdminApi({ request } as unknown as EdgeAccessClient)

      await expect(api.clients.get("cliente-1")).resolves.toMatchObject({
        logoUrl: "http://127.0.0.1:55321/storage/v1/object/sign/client-logos/clients/c1/logo.png?token=t",
      })
      const [fila] = await api.clients.list()
      expect(fila.logoUrl).toBe(
        "http://127.0.0.1:55321/storage/v1/object/sign/client-logos/clients/c1/logo.png?token=t",
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("removes a logo through the Edge asset route", async () => {
    const request = vi.fn().mockResolvedValue(clientDto)
    const api = createAdminApi({ request } as unknown as EdgeAccessClient)

    await api.clients.setLogo("cliente-1", null)

    expect(request).toHaveBeenCalledWith("clients/cliente-1/logo", expect.anything(), {
      method: "DELETE",
    })
  })
})

describe("Cuenta lifecycle mapping", () => {
  it("preserves the backend Cuenta state for administrative screens", async () => {
    const request = vi.fn().mockResolvedValue([
      {
        id: "account-1",
        email: "pending@example.test",
        nombre: "Ada",
        apellido: "Lovelace",
        rol: "cliente",
        activo: false,
        estado: "pendiente",
        creado_en: "2026-10-05T00:00:00Z",
      },
    ])
    const api = createAdminApi({ request } as unknown as EdgeAccessClient)

    await expect(api.accounts.list("client-1")).resolves.toMatchObject([
      { id: "account-1", activo: false, estadoCuenta: "pendiente" },
    ])
  })
})
