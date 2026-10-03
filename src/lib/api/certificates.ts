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
  visitSignatureDtoSchema,
  type CertificateOptionValue,
  type CertificateTemplateInput,
  type UpdateCertificateDraftInput,
  type VisitSignatureUploadInput,
} from "./contracts"
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
  valveHistory: (valvulaId: string) =>
    [...certificateQueryKeys.all, "valve-history", valvulaId] as const,
  pendingClientSignatureVisits: () =>
    [...certificateQueryKeys.all, "pending-client-signature-visits"] as const,
}

export const certificateInvalidations = [certificateQueryKeys.all] as const

export function createCertificatesApi(edge: EdgeAccessClient) {
  const serviceWorkflow = createServiceWorkflowApi(edge)

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
    valveHistory: (valvulaId: string) =>
      edge.request(`valves/${valvulaId}/certificates`, valveCertificateHistoryDtoSchema),
    pendingClientSignatureVisits: () =>
      edge.request("clients/me/pending-certificates", pendingClientSignatureVisitsDtoSchema),
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
