import type { ArbolYacimiento, Equipo, Planta, Valvula, Yacimiento } from "../domain/types"
import type { EdgeAccessClient } from "../services/edge"
import { z } from "zod"
import {
  createDescendantInputSchema,
  equipoDtoSchema,
  plantaDtoSchema,
  saveYacimientoInputSchema,
  valvulaDtoSchema,
  valveDetailDtoSchema,
  updateValveInputSchema,
  yacimientoDtoSchema,
  yacimientoAssignmentDtoSchema,
  yacimientoTreeDtoSchema,
  type CreateDescendantInput,
  type SaveYacimientoInput,
  type UpdateDescendantInput,
  type UpdateValveInput,
} from "./contracts"

export const hierarchyQueryKeys = {
  all: ["edge", "hierarchy"] as const,
  yacimientos: () => [...hierarchyQueryKeys.all, "yacimientos"] as const,
  tree: (yacimientoId: string) => [...hierarchyQueryKeys.all, "tree", yacimientoId] as const,
  valve: (valvulaId: string) => [...hierarchyQueryKeys.all, "valve", valvulaId] as const,
}

export const hierarchyInvalidations = [hierarchyQueryKeys.all] as const

export function toYacimientoView(
  dto: Awaited<ReturnType<typeof yacimientoDtoSchema.parse>>,
): Yacimiento {
  return {
    id: dto.id,
    empresaId: dto.cliente_cuenta_id,
    nombre: dto.nombre,
    provincia: dto.provincia ?? "",
    operadora: dto.operadora ?? "",
    contratista: dto.contratista ?? undefined,
  }
}

export function toPlantaView(dto: Awaited<ReturnType<typeof plantaDtoSchema.parse>>): Planta {
  return { id: dto.id, yacimientoId: dto.yacimiento_id, nombre: dto.nombre }
}

export function toEquipoView(dto: Awaited<ReturnType<typeof equipoDtoSchema.parse>>): Equipo {
  return { id: dto.id, plantaId: dto.planta_id, nombre: dto.nombre }
}

export function toValvulaView(dto: Awaited<ReturnType<typeof valvulaDtoSchema.parse>>): Valvula {
  const raw = dto as Record<string, unknown>
  const str = (key: string) =>
    typeof raw[key] === "string" && raw[key].trim() !== "" ? raw[key] : undefined
  const num = (key: string) =>
    typeof raw[key] === "number" && Number.isFinite(raw[key])
      ? raw[key]
      : typeof raw[key] === "string" && raw[key].trim() !== "" && Number.isFinite(Number(raw[key]))
        ? Number(raw[key])
        : undefined
  return {
    id: dto.id,
    equipoId: dto.equipo_id,
    tag: dto.nombre,
    ...(str("precinto") !== undefined ? { precinto: str("precinto") } : {}),
    ...(str("servicio") !== undefined ? { servicio: str("servicio") } : {}),
    ...(str("marca") !== undefined ? { marca: str("marca") } : {}),
    ...(str("numero_serie") !== undefined ? { nroSerie: str("numero_serie") } : {}),
    ...(str("modelo") !== undefined ? { modelo: str("modelo") } : {}),
    ...(str("tipo") !== undefined ? { tipo: str("tipo") } : {}),
    ...(str("pv") !== undefined ? { pv: str("pv") } : {}),
    ...(str("diametro_entrada") !== undefined ? { diamEntrada: str("diametro_entrada") } : {}),
    ...(str("diametro_salida") !== undefined ? { diamSalida: str("diametro_salida") } : {}),
    ...(str("rosca") !== undefined ? { rosca: str("rosca") } : {}),
    ...(num("presion_operacion") !== undefined
      ? { presionOperacion: num("presion_operacion") }
      : {}),
    ...(num("temperatura_operacion") !== undefined
      ? { temperaturaOperacion: num("temperatura_operacion") }
      : {}),
    ...(str("notas") !== undefined ? { notas: str("notas") } : {}),
  }
}

/** Maps the supported tree response; no Cliente→Yacimiento substitution occurs. */
export function toYacimientoTreeView(
  dto: Awaited<ReturnType<typeof yacimientoTreeDtoSchema.parse>>,
): ArbolYacimiento {
  return {
    ...toYacimientoView(dto.yacimiento),
    plantas: dto.plantas.map((planta) => ({
      ...toPlantaView(planta),
      equipos: dto.equipos
        .filter((equipo) => equipo.planta_id === planta.id)
        .map((equipo) => ({
          ...toEquipoView(equipo),
          valvulas: dto.valvulas
            .filter((valvula) => valvula.equipo_id === equipo.id)
            .map((valvula) => ({ ...toValvulaView(valvula), certificados: 0 })),
        })),
    })),
  }
}

export function createHierarchyApi(edge: EdgeAccessClient) {
  return {
    async listYacimientos() {
      const response = await edge.request("yacimientos", yacimientoDtoSchema.array())
      return response.map(toYacimientoView)
    },

    async tree(yacimientoId: string) {
      return toYacimientoTreeView(
        await edge.request(`yacimientos/${yacimientoId}/tree`, yacimientoTreeDtoSchema),
      )
    },

    valve: (valvulaId: string) => edge.request(`valves/${valvulaId}`, valveDetailDtoSchema),

    async updateValve(valvulaId: string, input: UpdateValveInput) {
      const data = updateValveInputSchema.parse(input)
      return edge.request(`valves/${valvulaId}`, valveDetailDtoSchema, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },

    assignment: (yacimientoId: string) =>
      edge.request(`yacimientos/${yacimientoId}/assignment`, yacimientoAssignmentDtoSchema),

    async createYacimiento(input: SaveYacimientoInput) {
      const data = saveYacimientoInputSchema.parse(input)
      return toYacimientoView(
        await edge.request("yacimientos", yacimientoDtoSchema, {
        method: "POST",
          body: JSON.stringify({ ...data, client_id: data.clientId }),
        }),
      )
    },

    async updateYacimiento(yacimientoId: string, input: SaveYacimientoInput) {
      const data = saveYacimientoInputSchema.parse(input)
      return toYacimientoView(
        await edge.request(`yacimientos/${yacimientoId}`, yacimientoDtoSchema, {
          method: "PATCH",
          body: JSON.stringify(data),
        }),
      )
    },

    async createDescendant(input: CreateDescendantInput) {
      const data = createDescendantInputSchema.parse(input)
      const schema = z.union([plantaDtoSchema, equipoDtoSchema, valvulaDtoSchema])
      return edge.request("hierarchy", schema, {
        method: "POST",
        body: JSON.stringify({ kind: data.kind, parent_id: data.parentId, name: data.name }),
      })
    },

    async updateDescendant(id: string, input: UpdateDescendantInput) {
      const data = createDescendantInputSchema.pick({ kind: true, name: true }).parse(input)
      const schema = z.union([plantaDtoSchema, equipoDtoSchema, valvulaDtoSchema])
      return edge.request(`hierarchy/${id}`, schema, {
        method: "PATCH",
        body: JSON.stringify({ kind: data.kind, name: data.name }),
      })
    },
  }
}

export type HierarchyApi = ReturnType<typeof createHierarchyApi>
