import { z } from "zod"

import type { EdgeAccessClient } from "../services/edge"
import {
  certificateDraftDtoSchema,
  certificateCaptureCatalogsSchema,
  certificateTemplateInputSchema,
  certificateTemplateListDtoSchema,
  certificateTemplateSchema,
  finalizedCertificateDtoSchema,
  pendingClientSignatureVisitsDtoSchema,
  updateCertificateDraftInputSchema,
  valveCertificateHistoryDtoSchema,
  valveHistoriesDtoSchema,
  visitSignatureDtoSchema,
  type CertificateOptionValue,
  type CertificateTemplateInput,
  type UpdateCertificateDraftInput,
  type ValveHistoriesDto,
  type VisitSignatureUploadInput,
} from "./contracts"
import { ServiceError } from "../services/contracts"
import { createServiceWorkflowApi } from "./service-workflow"

export const CERTIFICATE_EVIDENCE_SECTIONS = [
  { key: "desarmada", label: "Válvula desarmada" },
  { key: "ensamblada_prueba", label: "Válvula ensamblada para prueba" },
  { key: "placa_precinto", label: "Válvula con placa y precinto" },
] as const

export type CertificateEvidenceKey = (typeof CERTIFICATE_EVIDENCE_SECTIONS)[number]["key"]

export function buildCertificateDraftPayload(input: {
  catalogVersion: string
  maintenanceScope: CertificateOptionValue[]
  replacementPartIds: CertificateOptionValue[]
  otherParts?: string
  observations?: string
  customFields?: Record<string, unknown>
  evidence?: Partial<Record<CertificateEvidenceKey, unknown>>
}) {
  const evidence = input.evidence ?? {}
  return {
    alcance_mantenimiento: input.maintenanceScope,
    repuestos: {
      catalog_version: input.catalogVersion,
      items: input.replacementPartIds,
      otros: input.otherParts?.trim() || null,
    },
    campos_personalizados: input.customFields ?? {},
    evidencia_fotografica: {
      desarmada: evidence.desarmada ?? null,
      ensamblada_prueba: evidence.ensamblada_prueba ?? null,
      placa_precinto: evidence.placa_precinto ?? null,
    },
    observaciones: input.observations?.trim() || null,
  }
}

export const certificateQueryKeys = {
  all: ["edge", "certificates"] as const,
  activeTemplate: () => [...certificateQueryKeys.all, "active-template"] as const,
  draft: (certificateId: string) => [...certificateQueryKeys.all, "draft", certificateId] as const,
  finalized: (certificateId: string) =>
    [...certificateQueryKeys.all, "finalized", certificateId] as const,
  clientExport: (certificateId: string) =>
    [...certificateQueryKeys.all, "client-export", certificateId] as const,
  valveHistory: (valvulaId: string) =>
    [...certificateQueryKeys.all, "valve-history", valvulaId] as const,
  valveHistories: (valvulaIds: readonly string[]) =>
    [...certificateQueryKeys.all, "valve-histories", ...valvulaIds] as const,
  pendingClientSignatureVisits: () =>
    [...certificateQueryKeys.all, "pending-client-signature-visits"] as const,
}

export const certificateInvalidations = [certificateQueryKeys.all] as const

export const authorizeCertificateCorrectionInputSchema = z
  .object({
    providerId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: z.string().trim().min(1),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    path: ["endsAt"],
    message: "La finalización debe ser posterior al inicio",
  })

const certificateCorrectionDtoSchema = z.object({
  correction_id: z.uuid(),
  source_certificate_id: z.uuid(),
  request_id: z.uuid(),
  visit_id: z.uuid(),
  work_order_id: z.uuid(),
  reason: z.string(),
})

/** Válvulas por pedido de `valveHistories` (el servidor acepta hasta 200). */
export const VALVULAS_POR_LOTE = 100

export function createCertificatesApi(edge: EdgeAccessClient) {
  const serviceWorkflow = createServiceWorkflowApi(edge)
  const valveHistory = (valvulaId: string) =>
    edge.request(`valves/${valvulaId}/certificates`, valveCertificateHistoryDtoSchema)

  /** Respaldo mientras el servidor no tenga la ruta en lote: un pedido por Válvula. */
  async function historialesUnoPorUno(ids: string[]): Promise<ValveHistoriesDto> {
    const resultados = await Promise.allSettled(ids.map(valveHistory))
    const histories: ValveHistoriesDto["histories"] = []
    const failed: string[] = []
    resultados.forEach((resultado, i) => {
      if (resultado.status === "fulfilled") histories.push({ valve_id: ids[i], ...resultado.value })
      else failed.push(ids[i])
    })
    return { histories, failed_valve_ids: failed }
  }

  async function lote(ids: string[]): Promise<ValveHistoriesDto> {
    try {
      return await edge.request("certificates/valve-histories", valveHistoriesDtoSchema, {
        method: "POST",
        body: JSON.stringify({ valve_ids: ids }),
      })
    } catch (error) {
      if (error instanceof ServiceError && error.code === "not_found")
        return historialesUnoPorUno(ids)
      throw error
    }
  }

  return {
    activeTemplate: () => edge.request("certificate-templates/active", certificateTemplateSchema),
    templates: () => edge.request("certificate-templates", certificateTemplateListDtoSchema),
    captureCatalogs: () =>
      edge.request("certificate-capture/catalogs", certificateCaptureCatalogsSchema),
    createTemplate: async (input: CertificateTemplateInput) => {
      const data = certificateTemplateInputSchema.parse(input)
      return edge.request("certificate-templates", certificateTemplateSchema, {
        method: "POST",
        body: JSON.stringify(data),
      })
    },
    updateTemplate: async (id: string, input: CertificateTemplateInput) => {
      const data = certificateTemplateInputSchema.parse(input)
      return edge.request(`certificate-templates/${id}`, certificateTemplateSchema, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },
    activateTemplate: (id: string) =>
      edge.request(`certificate-templates/${id}/activate`, certificateTemplateSchema, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    draft: (certificateId: string) =>
      edge.request(`certificates/${certificateId}`, certificateDraftDtoSchema),
    finalized: (certificateId: string) =>
      edge.request(`certificates/${certificateId}/finalized`, finalizedCertificateDtoSchema),
    download: (certificateId: string) =>
      edge.request(`certificates/${certificateId}/download`, finalizedCertificateDtoSchema),
    valveHistory,
    /** Historiales de varias Válvulas en pedidos de a {@link VALVULAS_POR_LOTE}. */
    async valveHistories(valvulaIds: readonly string[]): Promise<ValveHistoriesDto> {
      const ids = [...new Set(valvulaIds)]
      const lotes: string[][] = []
      for (let i = 0; i < ids.length; i += VALVULAS_POR_LOTE)
        lotes.push(ids.slice(i, i + VALVULAS_POR_LOTE))
      const respuestas = await Promise.all(lotes.map(lote))
      return {
        histories: respuestas.flatMap((r) => r.histories),
        failed_valve_ids: respuestas.flatMap((r) => r.failed_valve_ids),
      }
    },
    pendingClientSignatureVisits: () =>
      edge.request("clients/me/pending-certificates", pendingClientSignatureVisitsDtoSchema),
    authorizeCorrection: (
      certificateId: string,
      input: z.input<typeof authorizeCertificateCorrectionInputSchema>,
    ) => {
      const id = z.uuid().parse(certificateId)
      const data = authorizeCertificateCorrectionInputSchema.parse(input)
      return edge.request(`certificates/${id}/corrections`, certificateCorrectionDtoSchema, {
        method: "POST",
        body: JSON.stringify({
          provider_id: data.providerId,
          starts_at: data.startsAt,
          ends_at: data.endsAt,
          reason: data.reason,
        }),
      })
    },
    startCertificateDraft: serviceWorkflow.startCertificateDraft,

    async updateDraft(certificateId: string, input: UpdateCertificateDraftInput) {
      const data = updateCertificateDraftInputSchema.parse(input)
      return edge.request(`certificates/${certificateId}`, certificateDraftDtoSchema, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },

    async uploadVisitSignature(visitId: string, input: VisitSignatureUploadInput) {
      if (!(input.file instanceof File)) throw new TypeError("La firma debe ser una imagen")
      const signerName = input.signerName.trim()
      if (!signerName) throw new TypeError("El nombre del firmante es obligatorio")
      const form = new FormData()
      form.set("party", input.party)
      if (input.captureMethod) form.set("capture_method", input.captureMethod)
      form.set("signer_name", signerName)
      form.set("file", input.file, input.file.name || "firma.png")
      return edge.request(`visits/${visitId}/signatures`, visitSignatureDtoSchema, {
        method: "POST",
        body: form,
      })
    },
  }
}

export type CertificatesApi = ReturnType<typeof createCertificatesApi>
