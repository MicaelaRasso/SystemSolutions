import { describe, expect, it } from "vitest"

import { armarCertificadoVista, firmasDeVisita, urlPublicaDeStorage } from "./certificado-vista"

const snapshot = {
  yacimiento: {
    nombre: "Yacimiento Norte",
    provincia: "Neuquén",
    operadora: "Operadora Demo SA",
    contratista: null,
  },
  planta: { nombre: "Planta Compresora 3" },
  equipo: { nombre: "K-100" },
  valvula: { nombre: "PSV-1001", marca: "Marca Demo", modelo: null, razon_disponibilidad: null },
}

const certificado = {
  id: "c-1",
  numero: 14,
  estado: "finalizado",
  fecha_ejecucion: "2026-02-04",
  tecnico_ejecutor: "Técnico Demo",
  instantanea: snapshot,
  datos_tecnicos: {
    valvula: {
      marca: "Marca Demo",
      numero_serie: "",
      tipo: "PILOTADA",
      diametro_entrada: '1 1/2"',
      clase_entrada: "#300",
      diametro_salida: "",
      clase_salida: "",
      rosca: "NO APLICA",
      razon_disponibilidad: null,
    },
    ensayos: {
      sp_inicial: { valor: 12.3, unidad: "Kg/Cm2" },
      sp_apertura: { valor: 12.4, unidad: "Kg/Cm2" },
      presion_cierre: { valor: 12.1, unidad: "Kg/Cm2" },
      patron: { id: "p-1", label: "KELLER LEO 1 N°122330" },
    },
  },
  campos_personalizados: { precinto: "9438239", pd_rto: "4078", color_tapa: "Rojo" },
  plantilla_snapshot: {
    campos: [
      { clave: "precinto", etiqueta: "Precinto" },
      { clave: "pd_rto", etiqueta: "PD/RTO" },
      { clave: "color_tapa", etiqueta: "Color de tapa" },
    ],
  },
  alcance_mantenimiento: [{ id: "a-1", label: "DESARME" }, "LIMPIEZA", "LAVADO EXTRA"],
  repuestos: { catalog_version: "v1", items: [{ id: "r-1", label: "RESORTE" }], otros: "Arandela" },
  evidencia_fotografica: {
    desarmada: { media_id: "m-1", bucket: "evidence", object_path: "a/b.jpg" },
    ensamblada_prueba: null,
    placa_precinto: "https://storage.example.test/firmado.jpg",
  },
  observaciones: null,
}

describe("armarCertificadoVista", () => {
  const vista = armarCertificadoVista({ certificate: certificado })

  it("toma la ubicación de la instantánea y marca con guion lo que falta", () => {
    expect(vista.ubicacion).toEqual({
      provincia: "Neuquén",
      yacimiento: "Yacimiento Norte",
      operadora: "Operadora Demo SA",
      contratista: "—",
      locacion: "Planta Compresora 3",
      equipo: "K-100",
    })
    expect(vista.observaciones).toBe("—")
  })

  it("formatea número y fecha como el modelo y arma el nombre del archivo", () => {
    expect(vista.numero).toBe("26-02-0014")
    expect(vista.fechaEjecucion).toBe("04-02-26")
    expect(vista.nombreArchivo).toBe("PSV-1001_K-100_PLANTA-COMPRESORA-3_26-02-0014")
  })

  it("lee datos de la válvula sin inventar los que no existen", () => {
    expect(vista.valvula).toMatchObject({
      tag: "PSV-1001",
      marca: "Marca Demo",
      serie: "—",
      modelo: "—",
      tipo: "PILOTADA",
      diametroEntrada: '1 1/2" #300',
      diametroSalida: "—",
      rosca: "NO APLICA",
      precinto: "9438239",
      servicio: "—",
      pv: "—",
    })
    expect(vista.pdRto).toBe("4078")
    expect(vista.ordenTrabajo).toBe("—")
  })

  it("resuelve ordenTrabajo comercial y descarta UUIDs de base de datos", () => {
    const conOt = armarCertificadoVista({
      certificate: {
        ...certificado,
        orden_trabajo: "OT-9912",
      },
    })
    expect(conOt.ordenTrabajo).toBe("OT-9912")

    const conUuid = armarCertificadoVista({
      certificate: {
        ...certificado,
        orden_trabajo: "12345678-1234-1234-1234-123456789abc",
      },
    })
    expect(conUuid.ordenTrabajo).toBe("—")
  })

  it("muestra la marca de dato no disponible cuando la válvula la declara", () => {
    const sinDatos = armarCertificadoVista({
      certificate: {
        ...certificado,
        datos_tecnicos: { valvula: { razon_disponibilidad: "not_found", marca: "" } },
      },
    })
    expect(sinDatos.valvula.marca).toBe("DATO NO ENCONTRADO")
    expect(sinDatos.valvula.serie).toBe("DATO NO ENCONTRADO")
  })

  it("arma las casillas del modelo y agrega las elegidas fuera de la lista", () => {
    const alcance = Object.fromEntries(vista.mantenimiento.alcance.map((c) => [c.label, c.marcado]))
    expect(alcance.DESARME).toBe(true)
    expect(alcance.LIMPIEZA).toBe(true)
    expect(alcance.DESMONTAJE).toBe(false)
    expect(alcance["LAVADO EXTRA"]).toBe(true)
    const repuestos = vista.mantenimiento.repuestos.filter((c) => c.marcado).map((c) => c.label)
    expect(repuestos).toEqual(["RESORTE"])
    expect(vista.mantenimiento.otros).toBe("Arandela")
  })

  it("formatea los ensayos con coma decimal", () => {
    expect(vista.ensayos.spInicial).toEqual({ valor: "12,3", unidad: "Kg/Cm2" })
    expect(vista.ensayos.patron).toBe("KELLER LEO 1 N°122330")
    expect(vista.ensayos.vencimientoPatron).toBe("—")
    expect(vista.ensayos.ejecuto).toBe("Técnico Demo")
  })

  it("solo usa direcciones de fotos que existen y marca las registradas sin vista", () => {
    expect(vista.fotos.desarmada).toEqual([{ url: null }])
    expect(vista.fotos.ensamblada_prueba).toEqual([])
    expect(vista.fotos.placa_precinto).toEqual([
      { url: "https://storage.example.test/firmado.jpg" },
    ])
  })

  it("lista los campos personalizados que el modelo no ubica", () => {
    expect(vista.adicionales).toEqual([{ etiqueta: "Color de tapa", valor: "Rojo" }])
  })

  it("sin número usa un nombre de archivo provisorio", () => {
    const pendiente = armarCertificadoVista({
      certificate: { ...certificado, numero: null, estado: "pendiente" },
    })
    expect(pendiente.numero).toBe("Pendiente")
    expect(pendiente.nombreArchivo).toBe("PSV-1001_K-100_PLANTA-COMPRESORA-3_SIN-NUMERO")
  })
})

describe("firmasDeVisita", () => {
  it("reconoce cada parte y su firmante", () => {
    const firmas = firmasDeVisita([
      { parte: "tecnico", nombre_firmante: "Técnico Demo", captured_at: "2026-02-04T15:00:00Z" },
    ])
    expect(firmas.tecnico).toEqual({ nombre: "Técnico Demo", fecha: "04/02/2026", imagenUrl: null })
    expect(firmas.cliente).toBeNull()
  })

  it("tolera respuestas vacías", () => {
    expect(firmasDeVisita(undefined)).toEqual({ tecnico: null, cliente: null })
  })
})

describe("direcciones de imágenes (D7)", () => {
  it("usa la dirección firmada que agrega el backend a la imagen de la firma", () => {
    const firmas = firmasDeVisita([
      {
        parte: "cliente",
        nombre_firmante: "Juan Pérez",
        captured_at: "2026-02-04T15:00:00Z",
        image: { bucket: "certificate-signatures", object_path: "visits/v/cliente/f.png", url: "https://storage.example.test/f.png" },
      },
    ])
    expect(firmas.cliente?.imagenUrl).toBe("https://storage.example.test/f.png")
  })

  it("acepta el Storage local por http (127.0.0.1 o localhost) y rechaza otros http", () => {
    const local = "http://127.0.0.1:55321/storage/v1/object/sign/certificate-signatures/f.png?token=t"
    const firma = (url: string) =>
      firmasDeVisita([{ parte: "tecnico", nombre_firmante: "T", image: { url } }]).tecnico?.imagenUrl
    expect(firma(local)).toBe(local)
    expect(firma("http://localhost:54321/storage/v1/object/sign/x.png")).toBe(
      "http://localhost:54321/storage/v1/object/sign/x.png",
    )
    expect(firma("http://storage.example.test/x.png")).toBeNull()
    expect(firma("javascript:alert(1)")).toBeNull()
  })
})

describe("urlPublicaDeStorage", () => {
  const publica = "http://127.0.0.1:55321"
  it("lleva al host público la URL firmada con el host interno del Storage local", () => {
    expect(
      urlPublicaDeStorage("http://kong:8000/storage/v1/object/sign/certificate-signatures/a.png?token=t", publica),
    ).toBe("http://127.0.0.1:55321/storage/v1/object/sign/certificate-signatures/a.png?token=t")
  })

  it("no toca URLs https, otras rutas ni URLs inválidas", () => {
    const https = "https://ref.supabase.co/storage/v1/object/sign/certificate-evidence/a.png?token=t"
    expect(urlPublicaDeStorage(https, publica)).toBe(https)
    expect(urlPublicaDeStorage("http://kong:8000/otra/ruta.png", publica)).toBe("http://kong:8000/otra/ruta.png")
    expect(urlPublicaDeStorage("no es url", publica)).toBe("no es url")
    expect(urlPublicaDeStorage("http://kong:8000/storage/v1/object/sign/a.png", undefined)).toBe(
      "http://kong:8000/storage/v1/object/sign/a.png",
    )
  })
})
