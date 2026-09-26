"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { edgeApi } from "./index"
import { certificateInvalidations, certificateQueryKeys } from "./certificates"
import { hierarchyInvalidations, hierarchyQueryKeys } from "./hierarchy"
import { identityInvalidations, identityQueryKeys } from "./identity"
import { offlineInvalidations, offlineQueryKeys } from "./offline"
import { serviceWorkflowInvalidations, serviceWorkflowQueryKeys } from "./service-workflow"
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
  VisitSignatureInput,
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

export const useEdgeVisit = (visitId: string | undefined) =>
  useQuery({
    queryKey: serviceWorkflowQueryKeys.visit(visitId ?? ""),
    queryFn: () => edgeApi.serviceWorkflow.visit(visitId!),
    enabled: Boolean(visitId),
  })

export const useEdgeCertificateDraft = (certificateId: string | undefined) =>
  useQuery({
    queryKey: certificateQueryKeys.draft(certificateId ?? ""),
    queryFn: () => edgeApi.certificates.draft(certificateId!),
    enabled: Boolean(certificateId),
  })

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
  const invalidate = useInvalidate(serviceWorkflowInvalidations)
  return useMutation({
    mutationFn: ({ workOrderId, input }: { workOrderId: string; input: UpdateWorkOrderInput }) =>
      edgeApi.serviceWorkflow.updateWorkOrder(workOrderId, input),
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

export const useSubmitEdgeVisitSignature = () => {
  const invalidate = useInvalidate(certificateInvalidations)
  return useMutation({
    mutationFn: ({ visitId, input }: { visitId: string; input: VisitSignatureInput }) =>
      edgeApi.certificates.submitVisitSignature(visitId, input),
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
