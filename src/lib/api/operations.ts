import { z } from "zod"

import type { ID } from "../domain/types"
import type { EdgeAccessClient } from "../services/edge"
import {
  edgeIdSchema,
  operationDetailDtoSchema,
  operationListDtoSchema,
  operationStatusSchema,
  type OperationStatus,
} from "./contracts"

export const operationDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  }, "Expected a valid calendar date")

export const operationFiltersSchema = z
  .object({
    from: operationDateSchema.optional(),
    to: operationDateSchema.optional(),
    status: z.array(operationStatusSchema).optional(),
    workshopId: edgeIdSchema.optional(),
    clientId: edgeIdSchema.optional(),
    q: z.string().trim().min(1).max(200).optional(),
    limit: z.number().int().positive().max(100).optional(),
    offset: z.number().int().nonnegative().optional(),
  })
  .superRefine((data, context) => {
    if (data.from && data.to && data.from > data.to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "Expected from to be before or equal to to",
      })
    }
  })

export type OperationFilters = z.infer<typeof operationFiltersSchema>

export const operationQueryKeys = {
  all: ["edge", "operations"] as const,
  list: (filters: OperationFilters = {}) => [...operationQueryKeys.all, "list", filters] as const,
  detail: (operationId: string) => [...operationQueryKeys.all, "detail", operationId] as const,
}

/** Serializes only the canonical query names accepted by `/operations`. */
export function serializeOperationFilters(filters: OperationFilters = {}) {
  const data = operationFiltersSchema.parse(filters)
  const query = new URLSearchParams()

  if (data.from) query.set("from", data.from)
  if (data.to) query.set("to", data.to)
  if (data.status?.length) query.set("status", data.status.join(","))
  if (data.workshopId) query.set("workshop_id", data.workshopId)
  if (data.clientId) query.set("client_id", data.clientId)
  if (data.q) query.set("q", data.q)
  if (data.limit !== undefined) query.set("limit", String(data.limit))
  if (data.offset !== undefined) query.set("offset", String(data.offset))

  return query
}

export function createOperationsApi(edge: EdgeAccessClient) {
  return {
    async list(filters: OperationFilters = {}) {
      const query = serializeOperationFilters(filters)
      const path = query.size ? `operations?${query}` : "operations"
      return edge.request(path, operationListDtoSchema)
    },

    async get(operationId: ID) {
      const id = edgeIdSchema.parse(operationId)
      return edge.request(`operations/${encodeURIComponent(id)}`, operationDetailDtoSchema)
    },
  }
}

export type OperationsApi = ReturnType<typeof createOperationsApi>
export type { OperationStatus }
