import { edgeAccess } from "../services/edge"
import { createCertificatesApi } from "./certificates"
import { createSignaturesApi } from "./signatures"
import { createHierarchyApi } from "./hierarchy"
import { createIdentityApi } from "./identity"
import { createOfflineApi } from "./offline"
import { createServiceWorkflowApi } from "./service-workflow"
import { createServiceRequestsApi } from "./service-requests"
import { createValvesApi } from "./valves"
import { createVisitsApi } from "./visits"
import { createWorkOrdersApi } from "./work-orders"
import { createYacimientosApi } from "./yacimientos"
import { createAdminApi } from "./admin"
import { createOperationsApi } from "./operations"
import { createBackupsApi } from "./backups"
import { createObservabilityApi } from "./observability"

/**
 * Capability-oriented browser API. Components consume hooks/adapters built on
 * this object; capability adapters route each path to its owning Edge Function.
 */
export const edgeApi = {
  identity: createIdentityApi(edgeAccess),
  hierarchy: createHierarchyApi(edgeAccess),
  yacimientos: createYacimientosApi(edgeAccess),
  valves: createValvesApi(edgeAccess),
  serviceWorkflow: createServiceWorkflowApi(edgeAccess),
  serviceRequests: createServiceRequestsApi(edgeAccess),
  visits: createVisitsApi(edgeAccess),
  workOrders: createWorkOrdersApi(edgeAccess),
  certificates: createCertificatesApi(edgeAccess),
  signatures: createSignaturesApi(edgeAccess),
  offline: createOfflineApi(edgeAccess),
  admin: createAdminApi(edgeAccess),
  operations: createOperationsApi(edgeAccess),
  backups: createBackupsApi(edgeAccess),
  observability: createObservabilityApi(edgeAccess),
}

export * from "./contracts"
export * from "./certificates"
export * from "./availability"
export * from "./hierarchy"
export * from "./identity"
export * from "./offline"
export * from "./service-requests"
export * from "./service-workflow"
export * from "./signatures"
export * from "./valves"
export * from "./visits"
export * from "./work-orders"
export * from "./yacimientos"
export * from "./admin"
export * from "./operations"
export * from "./backups"
export * from "./observability"
