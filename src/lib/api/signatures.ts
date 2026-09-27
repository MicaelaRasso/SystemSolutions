import type { EdgeAccessClient } from "../services/edge"
import { createCertificatesApi, type CertificatesApi } from "./certificates"

export type SignaturesApi = Pick<CertificatesApi, "uploadVisitSignature">

/** Multipart visit-level signature upload; certificate reuse stays server-owned. */
export function createSignaturesApi(edge: EdgeAccessClient): SignaturesApi {
  const certificates = createCertificatesApi(edge)
  return { uploadVisitSignature: certificates.uploadVisitSignature }
}
