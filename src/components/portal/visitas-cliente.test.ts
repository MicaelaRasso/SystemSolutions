import { describe, expect, it } from "vitest"

import type { VisitDto } from "@/lib/api/contracts"

import {
  aVisitaCliente,
  contextoDeArboles,
  filtrarVisitas,
  separarTurnos,
  type VisitaCliente,
} from "./visitas-cliente"

const contexto = contextoDeArboles([
  {
    id: "y-1",
    nombre: "Yacimiento Norte",
    plantas: [
      {
        id: "p-1",
        nombre: "Planta A",
        equipos: [
          { id: "e-1", nombre: "K-100", valvulas: [{ id: "val-1" }, { id: "val-2" }] },
          { id: "e-2", nombre: "K-200", valvulas: [{ id: "val-3" }] },
        ],
      },
    ],
  },
  { id: "y-2", nombre: "Sur", plantas: [] },
])

const visita = (parcial: Record<string, unknown> = {}, ordenes = ["val-1", "val-2", "val-3"]) =>
  ({
    visit: {
      id: "v-1",
      yacimiento_id: "y-1",
      taller_movil_id: "t-1",
      estado: "aceptada",
      starts_at: "2026-10-09T11:00:00Z",
      ends_at: "2026-10-09T15:30:00Z",
      ...parcial,
    },
    work_orders: ordenes.map((valvula_id, i) => ({ id: `ot-${i}`, valvula_id })),
  }) as VisitDto

describe("aVisitaCliente", () => {
  it("usa la fecha y el horario estimado de Argentina y resuelve locación y equipo", () => {
    expect(aVisitaCliente(visita(), contexto)).toEqual({
      id: "v-1",
      fecha: "2026-10-09",
      horario: "08:00–12:30",
      inicio: "2026-10-09T11:00:00Z",
      yacimientoId: "y-1",
      yacimiento: "Yacimiento Norte",
      ubicaciones: ["Planta A · K-100", "Planta A · K-200"],
      plantaIds: ["p-1"],
      estado: "aceptada",
      valvulas: 3,
    })
  })

  it("una visita de madrugada UTC cae en el día anterior local", () => {
    expect(aVisitaCliente(visita({ starts_at: "2026-10-10T01:00:00Z" }), contexto).fecha).toBe(
      "2026-10-09",
    )
  })

  it("no inventa datos que el alcance no permite resolver", () => {
    const v = aVisitaCliente(
      visita({ yacimiento_id: "y-x", taller_movil_id: null }, ["otra"]),
      contexto,
    )
    expect(v.yacimiento).toBe("Yacimiento sin acceso")
    expect(v.ubicaciones).toEqual([])
  })
})

const lista: VisitaCliente[] = [
  aVisitaCliente(
    visita({
      id: "a",
      estado: "programada",
      starts_at: "2026-10-20T12:00:00Z",
      ends_at: "2026-10-20T14:00:00Z",
    }),
    contexto,
  ),
  aVisitaCliente(
    visita({
      id: "b",
      estado: "completada",
      starts_at: "2026-09-01T12:00:00Z",
      ends_at: "2026-09-01T14:00:00Z",
    }),
    contexto,
  ),
  aVisitaCliente(
    visita({
      id: "c",
      estado: "cancelada",
      starts_at: "2026-10-25T12:00:00Z",
      ends_at: "2026-10-25T14:00:00Z",
    }),
    contexto,
  ),
  aVisitaCliente(visita({ id: "d", estado: "en_curso", yacimiento_id: "y-2" }, []), contexto),
  aVisitaCliente(
    visita({ id: "f", estado: "requiere_finalizacion", starts_at: "2026-10-05T12:00:00Z" }),
    contexto,
  ),
  aVisitaCliente(
    visita({
      id: "e",
      estado: "solicitada",
      starts_at: "2026-10-12T12:00:00Z",
      ends_at: "2026-10-12T14:00:00Z",
    }),
    contexto,
  ),
]

describe("separarTurnos (RF-35)", () => {
  it("pendientes en orden cronológico e histórico del más reciente al más antiguo", () => {
    const { pendientes, historico } = separarTurnos(lista)
    // «Requiere finalización» sigue pendiente: puede faltar la firma del Cliente.
    expect(pendientes.map((v) => v.id)).toEqual(["f", "d", "e", "a"])
    expect(historico.map((v) => v.id)).toEqual(["c", "b"])
  })
})

describe("filtrarVisitas", () => {
  it("filtra por yacimiento, planta y rango de fechas inclusivo", () => {
    expect(filtrarVisitas(lista, { yacimientoId: "y-2" }).map((v) => v.id)).toEqual(["d"])
    expect(filtrarVisitas(lista, { plantaId: "p-1" })).toHaveLength(5)
    expect(
      filtrarVisitas(lista, { desde: "2026-10-12", hasta: "2026-10-20" }).map((v) => v.id),
    ).toEqual(["a", "e"])
    expect(filtrarVisitas(lista, {})).toHaveLength(6)
  })
})
