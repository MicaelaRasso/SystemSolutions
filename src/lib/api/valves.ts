import type { EdgeAccessClient } from "../services/edge"
import { createHierarchyApi, type HierarchyApi } from "./hierarchy"

export type ValvesApi = Pick<HierarchyApi, "valve" | "updateValve">

/** Valve detail and technical updates; certificate history remains in certificates. */
export function createValvesApi(edge: EdgeAccessClient): ValvesApi {
  const hierarchy = createHierarchyApi(edge)
  return {
    valve: hierarchy.valve,
    updateValve: hierarchy.updateValve,
  }
}
