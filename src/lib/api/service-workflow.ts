import { z } from "zod"

import type { EdgeAccessClient } from "../services/edge"
import {
  createServiceRequestInputSchema,
  createAdministrativeServiceRequestInputSchema,
  serviceRequestDtoSchema,
  scheduleVisitInputSchema,
  updateServiceRequestInputSchema,
  updateWorkOrderInputSchema,
  visitAdministrationInputSchema,
  visitAssignmentInputSchema,
  visitDtoSchema,
  visitTransitionDtoSchema,
  workOrderDtoSchema,
  certificateDraftDtoSchema,
  type CreateServiceRequestInput,
  type CreateAdministrativeServiceRequestInput,
  type ScheduleVisitInput,
  type UpdateServiceRequestInput,
  type UpdateWorkOrderInput,
} from "./contracts"

export const serviceWorkflowQueryKeys = {
  all: ["edge", "service-workflow"] as const,
  requests: () => [...serviceWorkflowQueryKeys.all, "requests"] as const,
  request: (requestId: string) => [...serviceWorkflowQueryKeys.requests(), requestId] as const,
  visits: () => [...serviceWorkflowQueryKeys.all, "visits"] as const,
  visit: (visitId: string) => [...serviceWorkflowQueryKeys.visits(), visitId] as const,
}

export const serviceWorkflowInvalidations = [serviceWorkflowQueryKeys.all] as const

const json = (value: unknown) => JSON.stringify(value)

const attachmentDtoSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  tipo: z.string(),
  url: z.string().url(),
  bucket: z.literal("attachments"),
  object_path: z.string(),
})

export function createServiceWorkflowApi(edge: EdgeAccessClient) {
  return {
    async uploadAttachment(file: File) {
      const form = new FormData()
      form.set("file", file)
      return edge.request("attachments", attachmentDtoSchema, {
        method: "POST",
        body: form,
      })
    },

    async visitAttachments(visitId: string) {
      return edge.request(
        `visits/${encodeURIComponent(visitId)}/attachments`,
        attachmentDtoSchema.array(),
      )
    },

    async updateRequestMetadata(requestId: string, metadata: Record<string, unknown>) {
      return edge.request(`requests/${encodeURIComponent(requestId)}/metadata`, z.unknown(), {
        method: "PATCH",
        body: json({ metadata }),
      })
    },

    listRequests: () => edge.request("requests", serviceRequestDtoSchema.array()),
    request: (requestId: string) => edge.request(`requests/${requestId}`, serviceRequestDtoSchema),

    async createRequest(input: CreateServiceRequestInput) {
      const data = createServiceRequestInputSchema.parse(input)
      return edge.request("requests", serviceRequestDtoSchema, {
        method: "POST",
        body: json({ yacimiento_id: data.yacimientoId, selections: data.selections }),
      })
    },

    async createAdministrativeRequest(input: CreateAdministrativeServiceRequestInput) {
      const data = createAdministrativeServiceRequestInputSchema.parse(input)
      return edge.request("admin/requests", serviceRequestDtoSchema, {
        method: "POST",
        body: json({
          cliente_cuenta_id: data.clientId,
          yacimiento_id: data.yacimientoId,
          selections: data.selections,
        }),
      })
    },

    async updateRequest(requestId: string, input: UpdateServiceRequestInput) {
      const data = updateServiceRequestInputSchema.parse(input)
      return edge.request(`requests/${requestId}`, serviceRequestDtoSchema, {
        method: "PATCH",
        body: json({ selections: data.selections }),
      })
    },

    async schedule(requestId: string, input: ScheduleVisitInput) {
      const data = scheduleVisitInputSchema.parse(input)
      return edge.request(`requests/${requestId}/schedule`, visitDtoSchema, {
        method: "POST",
        body: json({
          taller_movil_id: data.tallerMovilId,
          starts_at: data.startsAt,
          ends_at: data.endsAt,
        }),
      })
    },

    listVisits: () => edge.request("visits", visitDtoSchema.array()),
    visit: (visitId: string) => edge.request(`visits/${visitId}`, visitDtoSchema),

    transition(visitId: string, action: "accept" | "reject" | "cancel" | "start" | "complete") {
      return edge.request(`visits/${visitId}/${action}`, visitTransitionDtoSchema, {
        method: "POST",
        body: "{}",
      })
    },

    startVisit(visitId: string, replacementCatalogVersionId: string, deviceId: string) {
      return edge.request(`visits/${visitId}/start`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({
          replacement_catalog_version_id: replacementCatalogVersionId,
          device_id: deviceId,
        }),
      })
    },

    async assignVisit(visitId: string, input: { tallerMovilId: string; reason: string }) {
      const data = visitAssignmentInputSchema.parse(input)
      return edge.request(`visits/${visitId}/assign`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({
          taller_movil_id: data.tallerMovilId,
          starts_at: data.startsAt ?? null,
          ends_at: data.endsAt ?? null,
          reason: data.reason,
        }),
      })
    },

    async unassignVisit(visitId: string, input: { reason: string }) {
      const data = visitAdministrationInputSchema.parse(input)
      return edge.request(`visits/${visitId}/unassign`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({ reason: data.reason }),
      })
    },

    async reassignVisit(visitId: string, input: { tallerMovilId: string; reason: string }) {
      const data = visitAssignmentInputSchema.parse(input)
      return edge.request(`visits/${visitId}/reassign`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({
          taller_movil_id: data.tallerMovilId,
          starts_at: data.startsAt ?? null,
          ends_at: data.endsAt ?? null,
          reason: data.reason,
        }),
      })
    },

    async cancelVisitAsAdministrator(visitId: string, input: { reason: string }) {
      const data = visitAdministrationInputSchema.parse(input)
      return edge.request(`visits/${visitId}/cancel-administrator`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({ reason: data.reason }),
      })
    },

    addWorkOrder(visitId: string, valvulaId: string) {
      return edge.request(`visits/${visitId}/work-orders`, workOrderDtoSchema, {
        method: "POST",
        body: json({ valvula_id: valvulaId }),
      })
    },

    async updateWorkOrder(workOrderId: string, input: UpdateWorkOrderInput) {
      const data = updateWorkOrderInputSchema.parse(input)
      return edge.request(`work-orders/${workOrderId}`, workOrderDtoSchema, {
        method: "PATCH",
        body: json({ outcome: data.outcome, not_evaluated_reason: data.notEvaluatedReason }),
      })
    },

    startCertificateDraft: (workOrderId: string) =>
      edge.request(`work-orders/${workOrderId}/certificate-draft`, certificateDraftDtoSchema, {
        method: "POST",
        body: "{}",
      }),
  }
}

export type ServiceWorkflowApi = ReturnType<typeof createServiceWorkflowApi>
