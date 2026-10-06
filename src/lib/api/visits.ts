import type { EdgeAccessClient } from "../services/edge"
import { createServiceWorkflowApi, type ServiceWorkflowApi } from "./service-workflow"

export type VisitsApi = Pick<
  ServiceWorkflowApi,
  | "listVisits"
  | "visit"
  | "transition"
  | "startVisit"
  | "assignVisit"
  | "unassignVisit"
  | "reassignVisit"
  | "cancelVisitAsAdministrator"
>

/** #REVISAR: Cliente Calendario/Turnos should consume this canonical read path when screens exist. */
/** Visit queries and lifecycle commands already exposed by service-workflow. */
export function createVisitsApi(edge: EdgeAccessClient): VisitsApi {
  const serviceWorkflow = createServiceWorkflowApi(edge)
  return {
    listVisits: serviceWorkflow.listVisits,
    visit: serviceWorkflow.visit,
    transition: serviceWorkflow.transition,
    startVisit: serviceWorkflow.startVisit,
    assignVisit: serviceWorkflow.assignVisit,
    unassignVisit: serviceWorkflow.unassignVisit,
    reassignVisit: serviceWorkflow.reassignVisit,
    cancelVisitAsAdministrator: serviceWorkflow.cancelVisitAsAdministrator,
  }
}
