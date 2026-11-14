import { z } from "zod"

import type { EdgeAccessClient } from "../services/edge"
import { urlPublicaDeStorage } from "../storage-url"
import {
  createServiceRequestInputSchema,
  createAdministrativeServiceRequestInputSchema,
  createAdministrativeRequestWithVisitInputSchema,
  serviceRequestDtoSchema,
  serviceRequestWithVisitDtoSchema,
  scheduleVisitInputSchema,
  createFollowupVisitInputSchema,
  updateServiceRequestInputSchema,
  updateWorkOrderInputSchema,
  visitAdministrationInputSchema,
  visitAssignmentInputSchema,
  visitRescheduleInputSchema,
  visitDtoSchema,
  visitParteDiarioDtoSchema,
  visitParteDiarioImageRegisterDtoSchema,
  visitTransitionDtoSchema,
  workOrderDtoSchema,
  certificateDraftDtoSchema,
  type CreateServiceRequestInput,
  type CreateAdministrativeServiceRequestInput,
  type CreateAdministrativeRequestWithVisitInput,
  type ScheduleVisitInput,
  type CreateFollowupVisitInput,
  type UpdateServiceRequestInput,
  type UpdateWorkOrderInput,
  type VisitAssignmentInput,
  type VisitRescheduleInput,
} from "./contracts"

export const serviceWorkflowQueryKeys = {
  all: ["edge", "service-workflow"] as const,
  requests: () => [...serviceWorkflowQueryKeys.all, "requests"] as const,
  request: (requestId: string) => [...serviceWorkflowQueryKeys.requests(), requestId] as const,
  visits: () => [...serviceWorkflowQueryKeys.all, "visits"] as const,
  visit: (visitId: string) => [...serviceWorkflowQueryKeys.visits(), visitId] as const,
  parteDiario: (visitId: string) => [...serviceWorkflowQueryKeys.visit(visitId), "parte-diario"] as const,
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
      const adjuntos = await edge.request(
        `visits/${encodeURIComponent(visitId)}/attachments`,
        attachmentDtoSchema.array(),
      )
      return adjuntos.map((adjunto) => ({ ...adjunto, url: urlPublicaDeStorage(adjunto.url) }))
    },

    async visitParteDiario(visitId: string) {
      return edge.request(
        `visits/${encodeURIComponent(visitId)}/parte-diario`,
        visitParteDiarioDtoSchema,
      )
    },

    async setVisitParteDiario(visitId: string, codigo: string) {
      const clean = codigo.trim()
      if (!/^[A-Za-z0-9]+$/.test(clean)) {
        throw new Error("El número de Parte Diario debe ser alfanumérico (sin espacios ni símbolos)")
      }
      return edge.request(
        `visits/${encodeURIComponent(visitId)}/parte-diario`,
        visitParteDiarioDtoSchema,
        {
          method: "PUT",
          body: json({ codigo: clean }),
        },
      )
    },

    async uploadVisitParteDiarioImage(
      visitId: string,
      input: { codigo: string; imageId?: string; file: File },
    ) {
      const clean = input.codigo.trim()
      if (!/^[A-Za-z0-9]+$/.test(clean)) {
        throw new Error("El número de Parte Diario debe ser alfanumérico (sin espacios ni símbolos)")
      }
      const imageId = input.imageId ?? crypto.randomUUID()
      const form = new FormData()
      form.set("codigo", clean)
      form.set("image_id", imageId)
      form.set("file", input.file, input.file.name || `parte-diario-${imageId}.jpg`)
      return edge.request(
        `visits/${encodeURIComponent(visitId)}/parte-diario/images`,
        visitParteDiarioImageRegisterDtoSchema,
        {
          method: "POST",
          body: form,
        },
      )
    },

    downloadVisitParteDiarioImage(visitId: string, imageId: string) {
      return edge.download(
        `visits/${encodeURIComponent(visitId)}/parte-diario/images/${encodeURIComponent(imageId)}`,
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

    /** Crea solicitud, metadata y visita en una sola transacción (sin solicitudes huérfanas). */
    async createAdministrativeRequestWithVisit(input: CreateAdministrativeRequestWithVisitInput) {
      const data = createAdministrativeRequestWithVisitInputSchema.parse(input)
      return edge.request("admin/requests", serviceRequestWithVisitDtoSchema, {
        method: "POST",
        body: json({
          cliente_cuenta_id: data.clientId,
          yacimiento_id: data.yacimientoId,
          selections: data.selections,
          metadata: data.metadata,
          taller_movil_id: data.visit?.tallerMovilId ?? null,
          starts_at: data.visit?.startsAt ?? null,
          ends_at: data.visit?.endsAt ?? null,
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

    async createFollowupVisit(requestId: string, input: CreateFollowupVisitInput) {
      const data = createFollowupVisitInputSchema.parse(input)
      return edge.request(`requests/${encodeURIComponent(requestId)}/follow-up-visits`, visitDtoSchema, {
        method: "POST",
        body: json({
          source_visit_id: data.sourceVisitId,
          valve_ids: data.valveIds,
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

    async assignVisit(visitId: string, input: VisitAssignmentInput) {
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

    async reassignVisit(visitId: string, input: VisitAssignmentInput) {
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

    /** Cambia la fecha u horario de una visita que todavía no fue aceptada, con o sin taller. */
    async rescheduleVisit(visitId: string, input: VisitRescheduleInput) {
      const data = visitRescheduleInputSchema.parse(input)
      return edge.request(`visits/${encodeURIComponent(visitId)}/reschedule`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({ starts_at: data.startsAt, ends_at: data.endsAt, reason: data.reason ?? null }),
      })
    },

    async cancelVisitAsAdministrator(visitId: string, input: { reason: string }) {
      const data = visitAdministrationInputSchema.parse(input)
      return edge.request(`visits/${visitId}/cancel-administrator`, visitTransitionDtoSchema, {
        method: "POST",
        body: json({ reason: data.reason }),
      })
    },

    async reopenVisitAsAdministrator(visitId: string) {
      return edge.request(`visits/${visitId}/reopen-administrator`, visitTransitionDtoSchema, {
        method: "POST",
        body: "{}",
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
