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

