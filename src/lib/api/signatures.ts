import type { EdgeAccessClient } from "../services/edge"
import { createCertificatesApi, type CertificatesApi } from "./certificates"

export type SignaturesApi = Pick<CertificatesApi, "submitVisitSignature">

/** Visit-level signature registration; certificate reuse stays server-owned. */
export function createSignaturesApi(edge: EdgeAccessClient): SignaturesApi {
  const certificates = createCertificatesApi(edge)
  return { submitVisitSignature: certificates.submitVisitSignature }
}
