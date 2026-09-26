import type { EdgeAccessClient } from "../services/edge"
import { createServiceWorkflowApi, type ServiceWorkflowApi } from "./service-workflow"

export type WorkOrdersApi = Pick<ServiceWorkflowApi, "addWorkOrder" | "updateWorkOrder">

/** Work-order creation and independent outcome updates. */
export function createWorkOrdersApi(edge: EdgeAccessClient): WorkOrdersApi {
  const serviceWorkflow = createServiceWorkflowApi(edge)
  return {
    addWorkOrder: serviceWorkflow.addWorkOrder,
    updateWorkOrder: serviceWorkflow.updateWorkOrder,
  }
}
