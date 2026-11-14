import { describe, expect, it } from "vitest"

import { convertirOperacionATarea } from "./tarea-sheet"

describe("convertirOperacionATarea - ordenTrabajo sanitization", () => {
  const baseOperation = {
    id: "visit-1",
    solicitud_id: "req-1",
    numero_solicitud: 42,
    estado: "programada",
    starts_at: "2026-11-03T13:00:00.000Z",
    ends_at: "2026-11-03T17:00:00.000Z",
    cliente: { id: "client-1", nombre: "YPF SA" },
    yacimiento: { id: "yac-1", nombre: "Loma Campana" },
    taller_movil: { id: "taller-1", nombre: "Móvil 1" },
    ordenes: { total: 1, pendientes: 1, evaluadas: 0, no_evaluadas: 0 },
  }

  it("assigns commercial orden_trabajo when present in metadata", () => {
    const operation = {
      operation: baseOperation,
      request: {
        request: {
          id: "req-1",
          metadata: {
            orden_trabajo: "OT-2026-884",
            contacto: "Juan Pérez",
          },
        },
      },
      visit: {
        visit: { id: "visit-1" },
        work_orders: [{ work_order: { id: "f7d43232-9b5f-4d37-8833-289b4b0e512c" } }],
      },
      work_orders: [{ work_order: { id: "f7d43232-9b5f-4d37-8833-289b4b0e512c" } }],
    }

    const tarea = convertirOperacionATarea(operation as never)
    expect(tarea.ordenTrabajo).toBe("OT-2026-884")
  })

  it("filters out raw database UUIDs and returns undefined", () => {
    const operation = {
      operation: baseOperation,
      request: {
        request: {
          id: "req-1",
          metadata: {
            orden_trabajo: "f7d43232-9b5f-4d37-8833-289b4b0e512c",
          },
        },
      },
      visit: {
        visit: { id: "visit-1" },
        work_orders: [{ work_order: { id: "f7d43232-9b5f-4d37-8833-289b4b0e512c" } }],
      },
      work_orders: [{ work_order: { id: "f7d43232-9b5f-4d37-8833-289b4b0e512c" } }],
    }

    const tarea = convertirOperacionATarea(operation as never)
    expect(tarea.ordenTrabajo).toBeUndefined()
  })

  it("returns undefined when no orden_trabajo is specified", () => {
    const operation = {
      operation: baseOperation,
      request: {
        request: {
          id: "req-1",
          metadata: {},
        },
      },
      visit: {
        visit: { id: "visit-1" },
        work_orders: [{ work_order: { id: "f7d43232-9b5f-4d37-8833-289b4b0e512c" } }],
      },
      work_orders: [{ work_order: { id: "f7d43232-9b5f-4d37-8833-289b4b0e512c" } }],
    }

    const tarea = convertirOperacionATarea(operation as never)
    expect(tarea.ordenTrabajo).toBeUndefined()
  })
})


describe("convertirOperacionATarea - fechaSolicitud", () => {
  it("normaliza created_at a YYYY-MM-DD en hora argentina para que la edición valide", () => {
    const operation = {
      operation: {
        id: "visit-1",
        solicitud_id: "req-1",
        numero_solicitud: 7,
        estado: "programada",
        starts_at: "2026-11-05T13:00:00.000Z",
        ends_at: "2026-11-05T14:00:00.000Z",
        cliente: { id: "client-1", nombre: "Cliente" },
        yacimiento: { id: "yac-1", nombre: "Yacimiento" },
        taller_movil: null,
        ordenes: { total: 1, pendientes: 1, evaluadas: 0, no_evaluadas: 0 },
      },
      // 01:30 UTC del 3 es todavía el 2 de noviembre en Argentina (-03:00).
      request: { request: { id: "req-1", created_at: "2026-11-03T01:30:00.000Z", metadata: {} } },
      visit: { visit: { id: "visit-1" }, work_orders: [] },
      work_orders: [],
    }

    const tarea = convertirOperacionATarea(operation as never)
    expect(tarea.fechaSolicitud).toBe("2026-11-02")
    expect(tarea.fechaEjecucion).toBe("2026-11-05")
  })
})

describe("convertirOperacionATarea - fecha_solicitud en metadata", () => {
  it("prefiere la fecha de solicitud cargada en el formulario", () => {
    const operation = {
      operation: {
        id: "visit-1",
        solicitud_id: "req-1",
        numero_solicitud: 7,
        estado: "programada",
        starts_at: "2026-11-05T13:00:00.000Z",
        ends_at: "2026-11-05T14:00:00.000Z",
        cliente: { id: "client-1", nombre: "Cliente" },
        yacimiento: { id: "yac-1", nombre: "Yacimiento" },
        taller_movil: null,
        ordenes: { total: 1, pendientes: 1, evaluadas: 0, no_evaluadas: 0 },
      },
      request: {
        request: {
          id: "req-1",
          created_at: "2026-11-10T15:00:00.000Z",
          metadata: { fecha_solicitud: "2026-11-01" },
        },
      },
      visit: { visit: { id: "visit-1" }, work_orders: [] },
      work_orders: [],
    }

    expect(convertirOperacionATarea(operation as never).fechaSolicitud).toBe("2026-11-01")
  })
})
