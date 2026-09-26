import type { EdgeAccessClient } from "../services/edge"
import {
  certificateDraftDtoSchema,
  finalizedCertificateDtoSchema,
  updateCertificateDraftInputSchema,
  valveCertificateHistoryDtoSchema,
  visitSignatureDtoSchema,
  visitSignatureInputSchema,
  type UpdateCertificateDraftInput,
  type VisitSignatureInput,
} from "./contracts"

export const certificateQueryKeys = {
  all: ["edge", "certificates"] as const,
  draft: (certificateId: string) => [...certificateQueryKeys.all, "draft", certificateId] as const,
  finalized: (certificateId: string) =>
    [...certificateQueryKeys.all, "finalized", certificateId] as const,
  valveHistory: (valvulaId: string) =>
    [...certificateQueryKeys.all, "valve-history", valvulaId] as const,
}

export const certificateInvalidations = [certificateQueryKeys.all] as const

export function createCertificatesApi(edge: EdgeAccessClient) {
  return {
    draft: (certificateId: string) =>
      edge.request(`certificates/${certificateId}`, certificateDraftDtoSchema),
    finalized: (certificateId: string) =>
      edge.request(`certificates/${certificateId}/finalized`, finalizedCertificateDtoSchema),
    valveHistory: (valvulaId: string) =>
      edge.request(`valves/${valvulaId}/certificates`, valveCertificateHistoryDtoSchema),

    async updateDraft(certificateId: string, input: UpdateCertificateDraftInput) {
      const data = updateCertificateDraftInputSchema.parse(input)
      return edge.request(`certificates/${certificateId}`, certificateDraftDtoSchema, {
        method: "PATCH",
        body: JSON.stringify(data),
      })
    },

    async submitVisitSignature(visitId: string, input: VisitSignatureInput) {
      const data = visitSignatureInputSchema.parse(input)
      return edge.request(`visits/${visitId}/signatures`, visitSignatureDtoSchema, {
        method: "POST",
        // This registers a Storage reference only. Uploading the image bytes
        // remains intentionally unavailable until an Edge upload route exists.
        body: JSON.stringify({
          party: data.party,
          signer_name: data.signerName,
          bucket: data.bucket,
          object_path: data.objectPath,
        }),
      })
    },
  }
}

export type CertificatesApi = ReturnType<typeof createCertificatesApi>
