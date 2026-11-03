import { describe, expect, it } from "vitest"

import {
  type OfflineMedia,
  type OfflineStore,
  OfflineSyncCoordinator,
  type OperacionOffline,
  type VisitaOffline,
} from "@/lib/offline/sync"

class AlmacenEnMemoria implements OfflineStore {
  operations = new Map<string, OperacionOffline>()
  visits = new Map<string, VisitaOffline>()
  media = new Map<string, OfflineMedia>()

  async getOperation(id: string) {
    return this.operations.get(id)
  }
  async listOperations(visitId: string) {
    return [...this.operations.values()].filter((operation) => operation.visitId === visitId)
  }
  async saveOperation(operation: OperacionOffline) {
    this.operations.set(operation.operationId, { ...operation })
  }
  async saveVisit(visit: VisitaOffline) {
    this.visits.set(visit.id, { ...visit })
  }
  async getVisit(id: string) {
    return this.visits.get(id)
  }
  async listVisits() {
    return [...this.visits.values()]
  }
  async removeVisit(id: string) {
    this.visits.delete(id)
  }
  async deleteVisit(id: string) {
    this.visits.delete(id)
  }
  async saveMedia(media: OfflineMedia) {
    this.media.set(media.mediaId ?? media.id, media)
  }
  async getMedia(id: string) {
    return this.media.get(id)
  }
  async removeMedia(id: string) {
    this.media.delete(id)
  }
  async removeOperationPayload(id: string, receipt: OperacionOffline["receipt"]) {
    const operation = this.operations.get(id)
    if (operation) {
      this.operations.set(id, { ...operation, payload: {}, receipt, estado: "sincronizada" })
    }
  }
}

type OperacionEnviada = {
  operation_id: string
  idempotency_key: string
  device_timestamp: string
  kind?: string
  payload: { data?: { fecha_ejecucion?: string } }
}

/**
 * Servidor de prueba que cumple el contrato de `operaciones_sync`: una clave de idempotencia ya
 * vista no vuelve a aplicar la operación. Numera como el contador real, una vez por certificado.
 */
function servidorIdempotente() {
  const aplicadas = new Map<string, { numero: number }>()
  const estado = { siguiente: 100, enviosRecibidos: 0, falloPendiente: false }
  return {
    estado,
    aplicadas,
    syncVisit: async (_visitId: string, operaciones: unknown[]) => {
      estado.enviosRecibidos += 1
      const lote = operaciones as OperacionEnviada[]
      const respuesta = lote.map((operacion) => {
        if (!aplicadas.has(operacion.idempotency_key)) {
          aplicadas.set(operacion.idempotency_key, { numero: estado.siguiente })
          estado.siguiente += 1
        }
        return { operation_id: operacion.operation_id, estado: "sincronizada" as const }
      })
      // La respuesta se pierde después de aplicar: el cliente no se entera y vuelve a enviar.
      if (estado.falloPendiente) {
        estado.falloPendiente = false
        throw new Error("network unavailable")
      }
      return { operations: respuesta }
    },
  }
}

const reloj = (fecha: string) => {
  let secuencia = 0
  return {
    now: () => fecha,
    id: () => {
      secuencia += 1
      return `op-${secuencia}`
    },
  }
}

describe("sincronización sin conexión", () => {
  it("RNF-04 CA-02: reenviar un certificado cuya respuesta se perdió no duplica el certificado ni el número", async () => {
    const almacen = new AlmacenEnMemoria()
    const servidor = servidorIdempotente()
    const coordinador = new OfflineSyncCoordinator(almacen, servidor, reloj("2026-03-10T15:00:00.000Z"))
    await coordinador.queue("visita-1", "dispositivo-1", "complete_visit", { completed: true })

    servidor.estado.falloPendiente = true
    const primero = await coordinador.sync("visita-1", "dispositivo-1")
    expect(primero[0]).toMatchObject({ estado: "fallida" })

    const segundo = await coordinador.sync("visita-1", "dispositivo-1")
    expect(segundo[0]).toMatchObject({ estado: "sincronizada" })

    expect(servidor.estado.enviosRecibidos).toBe(2)
    expect(servidor.aplicadas.size).toBe(1)
    expect(servidor.estado.siguiente).toBe(101)
  })

  it("RNF-04: varios reintentos conservan la misma clave de idempotencia", async () => {
    const almacen = new AlmacenEnMemoria()
    const claves: string[] = []
    const coordinador = new OfflineSyncCoordinator(
      almacen,
      {
        syncVisit: async (_visitId, operaciones) => {
          claves.push(...(operaciones as OperacionEnviada[]).map((o) => o.idempotency_key))
          throw new Error("network unavailable")
        },
      },
      reloj("2026-03-10T15:00:00.000Z"),
    )
    await coordinador.queue("visita-1", "dispositivo-1", "complete_visit", { completed: true })
    await coordinador.sync("visita-1", "dispositivo-1")
    await coordinador.sync("visita-1", "dispositivo-1")
    await coordinador.sync("visita-1", "dispositivo-1")

    expect(claves).toHaveLength(3)
    expect(new Set(claves).size).toBe(1)
  })

  it("RN-08 CA-04: una sincronización tardía conserva la fecha de ejecución y la hora de captura del dispositivo", async () => {
    const almacen = new AlmacenEnMemoria()
    const enviadas: OperacionEnviada[] = []
    const horaDeCaptura = "2026-03-10T15:00:00.000Z"
    const coordinador = new OfflineSyncCoordinator(
      almacen,
      {
        syncVisit: async (_visitId, operaciones) => {
          enviadas.push(...(operaciones as OperacionEnviada[]))
          return {
            operations: (operaciones as OperacionEnviada[]).map((o) => ({
              operation_id: o.operation_id,
              estado: "sincronizada" as const,
            })),
          }
        },
      },
      reloj(horaDeCaptura),
    )
    await coordinador.queue("visita-1", "dispositivo-1", "update_certificate_draft", {
      certificate_id: "certificado-1",
      data: { fecha_ejecucion: "2026-03-10" },
    })

    // Días después, cuando vuelve la conexión.
    const tardio = new OfflineSyncCoordinator(
      almacen,
      {
        syncVisit: async (_visitId, operaciones) => {
          enviadas.push(...(operaciones as OperacionEnviada[]))
          return {
            operations: (operaciones as OperacionEnviada[]).map((o) => ({
              operation_id: o.operation_id,
              estado: "sincronizada" as const,
            })),
          }
        },
      },
      reloj("2026-03-20T09:00:00.000Z"),
    )
    await tardio.sync("visita-1", "dispositivo-1")
    void coordinador

    expect(enviadas).toHaveLength(1)
    expect(enviadas[0].device_timestamp).toBe(horaDeCaptura)
    expect(enviadas[0].payload.data?.fecha_ejecucion).toBe("2026-03-10")
  })

  it("RNF-07: una operación fallida se reintenta sola al vencer la espera, sin que nadie la pida", async () => {
    const almacen = new AlmacenEnMemoria()
    let intentos = 0
    const transporte = {
      syncVisit: async (_visitId: string, operaciones: unknown[]) => {
        intentos += 1
        if (intentos === 1) throw new Error("network unavailable")
        return {
          operations: (operaciones as OperacionEnviada[]).map((o) => ({
            operation_id: o.operation_id,
            estado: "sincronizada" as const,
          })),
        }
      },
    }
    const inicial = new OfflineSyncCoordinator(almacen, transporte, reloj("2026-03-10T15:00:00.000Z"))
    await inicial.queue("visita-1", "dispositivo-1", "complete_visit", { completed: true })
    await inicial.sync("visita-1", "dispositivo-1")

    const despues = new OfflineSyncCoordinator(almacen, transporte, reloj("2026-03-11T15:00:00.000Z"))
    const reintento = await despues.retryAutomatically("visita-1", "dispositivo-1")
    expect(reintento[0]).toMatchObject({ estado: "sincronizada" })
  })
})
