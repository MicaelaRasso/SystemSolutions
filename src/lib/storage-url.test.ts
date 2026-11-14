import { describe, expect, it } from "vitest"

import { urlPublicaDeStorage } from "./storage-url"

describe("urlPublicaDeStorage (P8: helper compartido)", () => {
  const publica = "http://127.0.0.1:55321"

  it("lleva una URL firmada por el Storage local (host interno) a la URL pública", () => {
    expect(
      urlPublicaDeStorage("http://kong:8000/storage/v1/object/sign/client-logos/a.png?token=t", publica),
    ).toBe("http://127.0.0.1:55321/storage/v1/object/sign/client-logos/a.png?token=t")
  })

  it("no toca las URL de producción (https), otras rutas ni valores que no son URL", () => {
    const https = "https://proyecto.supabase.co/storage/v1/object/sign/client-logos/a.png?token=t"
    expect(urlPublicaDeStorage(https, publica)).toBe(https)
    expect(urlPublicaDeStorage("http://kong:8000/otra/ruta.png", publica)).toBe("http://kong:8000/otra/ruta.png")
    expect(urlPublicaDeStorage("blob:http://localhost/x", publica)).toBe("blob:http://localhost/x")
    expect(urlPublicaDeStorage("no es url", publica)).toBe("no es url")
  })

  it("sin URL pública configurada devuelve la URL sin cambios", () => {
    const local = "http://kong:8000/storage/v1/object/sign/a.png"
    expect(urlPublicaDeStorage(local, "")).toBe(local)
  })
})
