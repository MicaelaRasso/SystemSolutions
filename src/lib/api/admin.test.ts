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
})
