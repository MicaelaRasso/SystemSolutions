import type { EdgeAccessClient } from "../services/edge"
import { createServiceWorkflowApi, type ServiceWorkflowApi } from "./service-workflow"

export type WorkOrdersApi = Pick<
  ServiceWorkflowApi,
  "addWorkOrder" | "createFieldValve" | "updateWorkOrder"
>

/** Work-order creation (including field valves) and independent outcome updates. */
export function createWorkOrdersApi(edge: EdgeAccessClient): WorkOrdersApi {
  const serviceWorkflow = createServiceWorkflowApi(edge)
  return {
    addWorkOrder: serviceWorkflow.addWorkOrder,
    createFieldValve: serviceWorkflow.createFieldValve,
    updateWorkOrder: serviceWorkflow.updateWorkOrder,
  }
}
