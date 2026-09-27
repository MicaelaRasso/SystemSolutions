import type { EdgeAccessClient } from "../services/edge"
import {
  certificateDraftDtoSchema,
  finalizedCertificateDtoSchema,
  pendingClientSignatureVisitsDtoSchema,
  updateCertificateDraftInputSchema,
  valveCertificateHistoryDtoSchema,
  visitSignatureDtoSchema,
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
  maintenanceScope: string[]
  replacementPartIds: string[]
  otherParts?: string
  observations?: string
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
    draft: (certificateId: string) =>
      edge.request(`certificates/${certificateId}`, certificateDraftDtoSchema),
    finalized: (certificateId: string) =>
      edge.request(`certificates/${certificateId}/finalized`, finalizedCertificateDtoSchema),
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
