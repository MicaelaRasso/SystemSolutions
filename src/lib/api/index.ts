import { edgeAccess } from "../services/edge"
import { createCertificatesApi } from "./certificates"
import { createHierarchyApi } from "./hierarchy"
import { createIdentityApi } from "./identity"
import { createOfflineApi } from "./offline"
import { createServiceWorkflowApi } from "./service-workflow"

/**
 * Capability-oriented browser API. Components consume hooks/adapters built on
 * this object; only this layer knows that service-access is an Edge Function.
 */
export const edgeApi = {
  identity: createIdentityApi(edgeAccess),
  hierarchy: createHierarchyApi(edgeAccess),
  serviceWorkflow: createServiceWorkflowApi(edgeAccess),
  certificates: createCertificatesApi(edgeAccess),
  offline: createOfflineApi(edgeAccess),
}

export * from "./contracts"
export * from "./certificates"
export * from "./hierarchy"
export * from "./identity"
export * from "./offline"
export * from "./service-workflow"
