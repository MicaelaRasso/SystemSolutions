import type { EdgeAccessClient } from "../services/edge"
import { createHierarchyApi, type HierarchyApi } from "./hierarchy"

export type YacimientosApi = Pick<
  HierarchyApi,
  | "listYacimientos"
  | "tree"
  | "assignment"
  | "createYacimiento"
  | "updateYacimiento"
  | "createDescendant"
  | "updateDescendant"
>

/** Yacimiento and descendant operations already supported by the asset API. */
export function createYacimientosApi(edge: EdgeAccessClient): YacimientosApi {
  const hierarchy = createHierarchyApi(edge)
  return {
    listYacimientos: hierarchy.listYacimientos,
    tree: hierarchy.tree,
    assignment: hierarchy.assignment,
    createYacimiento: hierarchy.createYacimiento,
    updateYacimiento: hierarchy.updateYacimiento,
    createDescendant: hierarchy.createDescendant,
    updateDescendant: hierarchy.updateDescendant,
  }
}
