import type { EdgeAccessClient } from "../services/edge"
import { createServiceWorkflowApi, type ServiceWorkflowApi } from "./service-workflow"

export type ServiceRequestsApi = Pick<
  ServiceWorkflowApi,
  "listRequests" | "request" | "createRequest" | "createAdministrativeRequest" | "updateRequest" | "schedule"
>

/** Service-request queries and the existing scheduling command. */
export function createServiceRequestsApi(edge: EdgeAccessClient): ServiceRequestsApi {
  const serviceWorkflow = createServiceWorkflowApi(edge)
  return {
    listRequests: serviceWorkflow.listRequests,
    request: serviceWorkflow.request,
    createRequest: serviceWorkflow.createRequest,
    createAdministrativeRequest: serviceWorkflow.createAdministrativeRequest,
    updateRequest: serviceWorkflow.updateRequest,
    schedule: serviceWorkflow.schedule,
  }
}
