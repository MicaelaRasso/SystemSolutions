import type { EdgeAccessClient } from "../services/edge"
import { createServiceWorkflowApi, type ServiceWorkflowApi } from "./service-workflow"

export type VisitsApi = Pick<ServiceWorkflowApi, "listVisits" | "visit" | "transition">

/** Visit queries and lifecycle commands already exposed by service-workflow. */
export function createVisitsApi(edge: EdgeAccessClient): VisitsApi {
  const serviceWorkflow = createServiceWorkflowApi(edge)
  return {
    listVisits: serviceWorkflow.listVisits,
    visit: serviceWorkflow.visit,
    transition: serviceWorkflow.transition,
  }
}
