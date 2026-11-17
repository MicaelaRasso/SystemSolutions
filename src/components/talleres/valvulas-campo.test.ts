import { describe, expect, it } from "vitest"

import {
  arbolesDeLaVisita,
  buscarValvulas,
  datosDeValvulaDeCampo,
  equiposDelCatalogo,
  valvulasDelCatalogo,
} from "./valvulas-campo"

const arbolVisita = {
  yacimiento: { id: "yac-1", nombre: "Loma Norte" },
  plantas: [{ id: "pl-1", yacimiento_id: "yac-1", nombre: "Batería 1" }],
  equipos: [
    { id: "eq-1", planta_id: "pl-1", nombre: "K-100" },
    { id: "eq-2", planta_id: "pl-1", nombre: "Separador" },
  ],
  valvulas: [
    { id: "v-1", equipo_id: "eq-1", nombre: "PSV-1" },
    { id: "v-2", equipo_id: "eq-2", nombre: "PSV-2", numero_serie: "SN-778" },
  ],
}

const arbolOtro = {
  yacimiento: { id: "yac-2", nombre: "Cañadón Sur" },
  plantas: [{ id: "pl-2", yacimiento_id: "yac-2", nombre: "Planta compresora" }],
  equipos: [{ id: "eq-3", planta_id: "pl-2", nombre: "Turbo" }],
  valvulas: [{ id: "v-3", equipo_id: "eq-3", nombre: "PSV-3" }],
}

describe("catálogo de válvulas en campo", () => {
  it("usa los yacimientos del Cliente con acceso y suma el de la visita si falta", () => {
    expect(
      arbolesDeLaVisita({ context: arbolVisita, client_yacimientos: [arbolOtro] }).map(
        (arbol) => arbol.yacimiento.id,
      ),
    ).toEqual(["yac-2", "yac-1"])
    expect(
      arbolesDeLaVisita({ context: arbolVisita, client_yacimientos: [arbolVisita, arbolOtro] }),
    ).toHaveLength(2)
    expect(arbolesDeLaVisita({ context: arbolVisita })).toEqual([arbolVisita])
    expect(arbolesDeLaVisita({})).toEqual([])
  })

  it("lista las válvulas con su ubicación y deja afuera las que ya están en la visita", () => {
    const lista = valvulasDelCatalogo([arbolVisita, arbolOtro], new Set(["v-1"]))

    expect(lista.map((valvula) => valvula.id)).toEqual(["v-3", "v-2"])
    expect(lista[1]).toMatchObject({
      nombre: "PSV-2",
      equipoId: "eq-2",
      equipoNombre: "Separador",
      plantaNombre: "Batería 1",
      yacimientoNombre: "Loma Norte",
    })
  })

  it("busca por TAG, equipo, planta, yacimiento o N° de serie sin importar tildes ni mayúsculas", () => {
    const lista = valvulasDelCatalogo([arbolVisita, arbolOtro], new Set())

    expect(buscarValvulas(lista, "psv-3").map((v) => v.id)).toEqual(["v-3"])
    expect(buscarValvulas(lista, "canadon").map((v) => v.id)).toEqual(["v-3"])
    expect(buscarValvulas(lista, "separador").map((v) => v.id)).toEqual(["v-2"])
    expect(buscarValvulas(lista, "sn-778").map((v) => v.id)).toEqual(["v-2"])
    expect(buscarValvulas(lista, "bateria k-100").map((v) => v.id)).toEqual(["v-1"])
    expect(buscarValvulas(lista, "  ")).toHaveLength(3)
  })

  it("arma la lista de equipos existentes para el alta (no se crean equipos)", () => {
    expect(equiposDelCatalogo([arbolVisita, arbolOtro])).toEqual([
      {
        id: "eq-3",
        nombre: "Turbo",
        plantaNombre: "Planta compresora",
        yacimientoId: "yac-2",
        yacimientoNombre: "Cañadón Sur",
      },
      {
        id: "eq-1",
        nombre: "K-100",
        plantaNombre: "Batería 1",
        yacimientoId: "yac-1",
        yacimientoNombre: "Loma Norte",
      },
      {
        id: "eq-2",
        nombre: "Separador",
        plantaNombre: "Batería 1",
        yacimientoId: "yac-1",
        yacimientoNombre: "Loma Norte",
      },
    ])
  })
})

describe("alta de válvula en campo", () => {
  it("convierte el formulario del admin en los datos que guarda el servidor", () => {
    expect(
      datosDeValvulaDeCampo({
        tag: " psv-77 ",
        precinto: "",
        servicio: "GAS",
        marca: " Crosby ",
        nroSerie: "SN-1",
        modelo: "",
        tipo: "CONVENCIONAL",
        pv: "",
        diamEntrada: '1"',
        diamSalida: "",
        rosca: "NPT",
        presionOperacion: "12,5",
        temperaturaOperacion: "",
        notas: "  ",
      }),
    ).toEqual({
      nombre: "PSV-77",
      precinto: null,
      servicio: "GAS",
      marca: "Crosby",
      numero_serie: "SN-1",
      modelo: null,
      tipo: "CONVENCIONAL",
      pv: null,
      diametro_entrada: '1"',
      diametro_salida: null,
      rosca: "NPT",
      presion_operacion: 12.5,
      temperatura_operacion: null,
      notas: null,
    })
  })
})
