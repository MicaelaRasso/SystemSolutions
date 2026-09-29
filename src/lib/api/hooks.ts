"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { edgeApi } from "./index"
import { certificateInvalidations, certificateQueryKeys } from "./certificates"
import { hierarchyInvalidations, hierarchyQueryKeys } from "./hierarchy"
import { identityInvalidations, identityQueryKeys } from "./identity"
import { offlineInvalidations, offlineQueryKeys } from "./offline"
import { serviceWorkflowInvalidations, serviceWorkflowQueryKeys } from "./service-workflow"
import { operationQueryKeys, type OperationFilters } from "./operations"
import type { AuditFilters } from "./observability"
import type {
  CreateDescendantInput,
  CreateServiceRequestInput,
  SaveYacimientoInput,
  ScheduleVisitInput,
  SyncVisitInput,
  UpdateCertificateDraftInput,
  UpdateDescendantInput,
  UpdateServiceRequestInput,
  UpdateValveInput,
  UpdateWorkOrderInput,
  VisitSignatureUploadInput,
} from "./contracts"

const useInvalidate = (keys: readonly (readonly unknown[])[]) => {
  const queryClient = useQueryClient()
  return () => Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export const useEdgeContext = () =>
  useQuery({ queryKey: identityQueryKeys.context(), queryFn: edgeApi.identity.context })

export const useEdgeYacimientos = () =>
  useQuery({
    queryKey: hierarchyQueryKeys.yacimientos(),
    queryFn: edgeApi.hierarchy.listYacimientos,
  })

export const useEdgeYacimientoTree = (yacimientoId: string | undefined) =>
  useQuery({
    queryKey: hierarchyQueryKeys.tree(yacimientoId ?? ""),
    queryFn: () => edgeApi.hierarchy.tree(yacimientoId!),
    enabled: Boolean(yacimientoId),
  })

export const useEdgeValve = (valvulaId: string | undefined) =>
  useQuery({
    queryKey: hierarchyQueryKeys.valve(valvulaId ?? ""),
    queryFn: () => edgeApi.hierarchy.valve(valvulaId!),
    enabled: Boolean(valvulaId),
  })

export const useEdgeValveCertificateHistory = (valvulaId: string | undefined) =>
  useQuery({
    queryKey: certificateQueryKeys.valveHistory(valvulaId ?? ""),
    queryFn: () => edgeApi.certificates.valveHistory(valvulaId!),
    enabled: Boolean(valvulaId),
  })

export const useEdgeServiceRequests = () =>
  useQuery({
    queryKey: serviceWorkflowQueryKeys.requests(),
    queryFn: edgeApi.serviceWorkflow.listRequests,
  })

export const useEdgeServiceRequest = (requestId: string | undefined) =>
  useQuery({
    queryKey: serviceWorkflowQueryKeys.request(requestId ?? ""),
    queryFn: () => edgeApi.serviceWorkflow.request(requestId!),
    enabled: Boolean(requestId),
  })

export const useEdgeVisits = () =>
  useQuery({
    queryKey: serviceWorkflowQueryKeys.visits(),
    queryFn: edgeApi.serviceWorkflow.listVisits,
  })

export const useEdgePendingClientSignatureVisits = () =>
  useQuery({
    queryKey: certificateQueryKeys.pendingClientSignatureVisits(),
    queryFn: edgeApi.certificates.pendingClientSignatureVisits,
  })

export const useEdgeVisit = (visitId: string | undefined) =>
  useQuery({
    queryKey: serviceWorkflowQueryKeys.visit(visitId ?? ""),
    queryFn: () => edgeApi.serviceWorkflow.visit(visitId!),
    enabled: Boolean(visitId),
  })

export const useEdgeOperations = (filters: OperationFilters = {}) =>
  useQuery({
    queryKey: operationQueryKeys.list(filters),
    queryFn: () => edgeApi.operations.list(filters),
  })

export const useEdgeOperation = (operationId: string | undefined) =>
  useQuery({
    queryKey: operationQueryKeys.detail(operationId ?? ""),
    queryFn: () => edgeApi.operations.get(operationId!),
    enabled: Boolean(operationId),
  })

export const useEdgeAdminMetrics = (from: string, to: string) =>
  useQuery({ queryKey: ["edge", "admin-metrics", from, to], queryFn: () => edgeApi.observability.metrics(from, to), enabled: Boolean(from && to) })
export const useEdgeAuditEvents = (action?: string) => {
  const filters: AuditFilters = action ? { action } : {}
  return useQuery({ queryKey: ["edge", "audit", filters], queryFn: () => edgeApi.observability.audit.list(filters) })
}
export const useEdgeAdminCertificates = (q?: string) =>
  useQuery({ queryKey: ["edge", "admin-certificates", q], queryFn: () => edgeApi.observability.certificates.list(q ? { q } : {}) })
export const useEdgeAdminCertificate = (id: string | undefined) =>
  useQuery({ queryKey: ["edge", "admin-certificate", id], queryFn: () => edgeApi.observability.certificates.get(id!), enabled: Boolean(id) })

export const useEdgeCertificateDraft = (certificateId: string | undefined) =>
  useQuery({
    queryKey: certificateQueryKeys.draft(certificateId ?? ""),
    queryFn: () => edgeApi.certificates.draft(certificateId!),
    enabled: Boolean(certificateId),
  })

export const useStartEdgeCertificateDraft = () => {
  const invalidate = useInvalidate(certificateInvalidations)
  return useMutation({
    mutationFn: (workOrderId: string) => edgeApi.certificates.startCertificateDraft(workOrderId),
    onSuccess: invalidate,
  })
}

export const useEdgeFinalizedCertificate = (certificateId: string | undefined) =>
  useQuery({
    queryKey: certificateQueryKeys.finalized(certificateId ?? ""),
    queryFn: () => edgeApi.certificates.finalized(certificateId!),
    enabled: Boolean(certificateId),
  })

export const useEdgeOfflineWorkingSet = () =>
  useQuery({
    queryKey: offlineQueryKeys.workingSet(),
    queryFn: edgeApi.offline.workingSet,
    enabled: false,
  })

export const useCreateEdgeYacimiento = () => {
  const invalidate = useInvalidate(hierarchyInvalidations)
  return useMutation({
    mutationFn: (input: SaveYacimientoInput) => edgeApi.hierarchy.createYacimiento(input),
    onSuccess: invalidate,
  })
}

export const useUpdateEdgeYacimiento = () => {
  const invalidate = useInvalidate(hierarchyInvalidations)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SaveYacimientoInput }) =>
      edgeApi.hierarchy.updateYacimiento(id, input),
    onSuccess: invalidate,
  })
}

export const useCreateEdgeDescendant = () => {
  const invalidate = useInvalidate(hierarchyInvalidations)
  return useMutation({
    mutationFn: (input: CreateDescendantInput) => edgeApi.hierarchy.createDescendant(input),
    onSuccess: invalidate,
  })
}

export const useUpdateEdgeDescendant = () => {
  const invalidate = useInvalidate(hierarchyInvalidations)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateDescendantInput }) =>
      edgeApi.hierarchy.updateDescendant(id, input),
    onSuccess: invalidate,
  })
}

export const useUpdateEdgeValve = () => {
  const invalidate = useInvalidate(hierarchyInvalidations)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateValveInput }) =>
      edgeApi.hierarchy.updateValve(id, input),
    onSuccess: invalidate,
  })
}

export const useCreateEdgeServiceRequest = () => {
  const invalidate = useInvalidate(serviceWorkflowInvalidations)
  return useMutation({
    mutationFn: (input: CreateServiceRequestInput) => edgeApi.serviceWorkflow.createRequest(input),
    onSuccess: invalidate,
  })
}

export const useUpdateEdgeServiceRequest = () => {
  const invalidate = useInvalidate(serviceWorkflowInvalidations)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateServiceRequestInput }) =>
      edgeApi.serviceWorkflow.updateRequest(id, input),
    onSuccess: invalidate,
  })
}

export const useScheduleEdgeVisit = () => {
  const invalidate = useInvalidate(serviceWorkflowInvalidations)
  return useMutation({
    mutationFn: ({ requestId, input }: { requestId: string; input: ScheduleVisitInput }) =>
      edgeApi.serviceWorkflow.schedule(requestId, input),
    onSuccess: invalidate,
  })
}

export const useTransitionEdgeVisit = () => {
  const invalidate = useInvalidate(serviceWorkflowInvalidations)
  return useMutation({
    mutationFn: ({
      visitId,
      action,
    }: {
      visitId: string
      action: "accept" | "reject" | "cancel" | "start" | "complete"
    }) => edgeApi.serviceWorkflow.transition(visitId, action),
    onSuccess: invalidate,
  })
}

export const useUpdateEdgeWorkOrder = () => {
  const invalidate = useInvalidate([...serviceWorkflowInvalidations, operationQueryKeys.all])
  return useMutation({
    mutationFn: ({ workOrderId, input }: { workOrderId: string; input: UpdateWorkOrderInput }) =>
      edgeApi.serviceWorkflow.updateWorkOrder(workOrderId, input),
    onSuccess: invalidate,
  })
}

export const useAddEdgeWorkOrder = () => {
  const invalidate = useInvalidate([...serviceWorkflowInvalidations, operationQueryKeys.all])
  return useMutation({
    mutationFn: ({ visitId, valveId }: { visitId: string; valveId: string }) =>
      edgeApi.serviceWorkflow.addWorkOrder(visitId, valveId),
    onSuccess: invalidate,
  })
}

export const useUpdateEdgeCertificateDraft = () => {
  const invalidate = useInvalidate(certificateInvalidations)
  return useMutation({
    mutationFn: ({
      certificateId,
      input,
    }: {
      certificateId: string
      input: UpdateCertificateDraftInput
    }) => edgeApi.certificates.updateDraft(certificateId, input),
    onSuccess: invalidate,
  })
}

export const useUploadEdgeVisitSignature = () => {
  const invalidate = useInvalidate([...certificateInvalidations, serviceWorkflowInvalidations[0]])
  return useMutation({
    mutationFn: ({ visitId, input }: { visitId: string; input: VisitSignatureUploadInput }) =>
      edgeApi.certificates.uploadVisitSignature(visitId, input),
    onSuccess: invalidate,
  })
}

export const useSyncEdgeVisit = () => {
  const invalidate = useInvalidate(offlineInvalidations)
  return useMutation({
    mutationFn: ({ visitId, input }: { visitId: string; input: SyncVisitInput }) =>
      edgeApi.offline.syncVisit(visitId, input),
    onSuccess: invalidate,
  })
}

/** Call after sign-in/out to evict identity-bound capability data. */
export const useInvalidateEdgeIdentity = () => useInvalidate(identityInvalidations)
