import type { EdgeAccessClient } from "../services/edge"
import { adminCertificateDetailDtoSchema, adminCertificateListDtoSchema, adminMetricsDtoSchema, auditEventDtoSchema, auditListDtoSchema, type AuditEventDto } from "./contracts"

export type AuditFilters = { from?: string; to?: string; actorId?: string; action?: string; targetType?: string; outcome?: "exitoso" | "fallido"; clientId?: string; yacimientoId?: string; visitId?: string; certificateId?: string; limit?: number; offset?: number }
const params = (filters: AuditFilters = {}) => {
  const query = new URLSearchParams()
  const map: Record<string, string | number | undefined> = { from: filters.from, to: filters.to, actor_id: filters.actorId, action: filters.action, target_type: filters.targetType, outcome: filters.outcome, client_id: filters.clientId, yacimiento_id: filters.yacimientoId, visit_id: filters.visitId, certificate_id: filters.certificateId, limit: filters.limit, offset: filters.offset }
  for (const [key, value] of Object.entries(map)) if (value !== undefined && value !== "") query.set(key, String(value))
  return query
}

export function createObservabilityApi(edge: EdgeAccessClient) {
  return {
    audit: {
      list: (filters: AuditFilters = {}) => edge.request(`audit?${params(filters)}`, auditListDtoSchema),
      get: (id: string) => edge.request(`audit/${encodeURIComponent(id)}`, auditEventDtoSchema.nullable()),
      export: (filters: AuditFilters, format: "json" | "csv") => edge.download(`audit/export?${params(filters)}&format=${format}`),
    },
    metrics: (from: string, to: string) => edge.request(`admin/metrics?from=${from}&to=${to}`, adminMetricsDtoSchema),
    certificates: {
      list: (filters: Record<string, string | undefined> = {}) => {
        const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value!]))
        return edge.request(`admin/certificates?${query}`, adminCertificateListDtoSchema)
      },
      get: (id: string) => edge.request(`admin/certificates/${encodeURIComponent(id)}`, adminCertificateDetailDtoSchema),
    },
  }
}
export type ObservabilityApi = ReturnType<typeof createObservabilityApi>
export type { AuditEventDto }
