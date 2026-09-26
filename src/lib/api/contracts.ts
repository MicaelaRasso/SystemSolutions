import { z } from "zod"

/**
 * Browser-facing DTOs for the routes that service-access exposes today.
 *
 * Table-shaped values are deliberately kept in snake_case and `passthrough`
 * here. They are transport contracts, not view models; each capability owns
 * the mapping to the fields its screen is allowed to rely on.
 */
export const edgeIdSchema = z.string().min(1)
export const edgeTimestampSchema = z.string().min(1)
export const edgeRecordSchema = z.object({ id: edgeIdSchema }).passthrough()

export const edgeContextSchema = z.object({
  cuenta_id: edgeIdSchema,
  rol: z.enum(["cliente", "taller_movil", "administrador_regular", "super_administrador"]),
  taller_movil_id: edgeIdSchema.nullable(),
  cliente: z.boolean(),
})
export type EdgeContextDto = z.infer<typeof edgeContextSchema>
export const edgeContextResponseSchema = z
  .union([edgeContextSchema, edgeContextSchema.array().min(1)])
  .transform((value) => (Array.isArray(value) ? value[0] : value))

export const yacimientoDtoSchema = z
  .object({
    id: edgeIdSchema,
    cliente_cuenta_id: edgeIdSchema,
    nombre: z.string(),
    provincia: z.string().nullable().optional(),
    operadora: z.string().nullable().optional(),
    contratista: z.string().nullable().optional(),
    created_at: edgeTimestampSchema.optional(),
  })
  .passthrough()
export type YacimientoDto = z.infer<typeof yacimientoDtoSchema>

export const plantaDtoSchema = z
  .object({
    id: edgeIdSchema,
    yacimiento_id: edgeIdSchema,
    nombre: z.string(),
  })
  .passthrough()
export type PlantaDto = z.infer<typeof plantaDtoSchema>

export const equipoDtoSchema = z
  .object({
    id: edgeIdSchema,
    planta_id: edgeIdSchema,
    nombre: z.string(),
  })
  .passthrough()
export type EquipoDto = z.infer<typeof equipoDtoSchema>

export const valvulaDtoSchema = z
  .object({
    id: edgeIdSchema,
    equipo_id: edgeIdSchema,
    nombre: z.string(),
  })
  .passthrough()
export type ValvulaDto = z.infer<typeof valvulaDtoSchema>

export const valveAvailabilityReasonSchema = z.enum(["not_applicable", "not_found"])
export const valveTechnicalFieldsSchema = z.object({
  marca: z.string().nullable(),
  numero_serie: z.string().nullable(),
  modelo: z.string().nullable(),
  tipo: z.string().nullable(),
  diametro_entrada: z.string().nullable(),
  clase_entrada: z.string().nullable(),
  diametro_salida: z.string().nullable(),
  clase_salida: z.string().nullable(),
  rosca: z.string().nullable(),
  razon_disponibilidad: valveAvailabilityReasonSchema.nullable(),
})
export const valveDetailDtoSchema = z
  .object({
    valve: valvulaDtoSchema.extend(valveTechnicalFieldsSchema.shape),
    revisions: z.array(
      z
        .object({
          id: edgeIdSchema,
          datos: z.record(z.string(), z.unknown()),
          created_at: edgeTimestampSchema,
        })
        .passthrough(),
    ),
  })
  .passthrough()
export type ValveDetailDto = z.infer<typeof valveDetailDtoSchema>

export const updateValveInputSchema = z.object({
  name: z.string().trim().min(1),
  ...valveTechnicalFieldsSchema.shape,
})
export type UpdateValveInput = z.infer<typeof updateValveInputSchema>

export const yacimientoTreeDtoSchema = z.object({
  yacimiento: yacimientoDtoSchema,
  plantas: z.array(plantaDtoSchema),
  equipos: z.array(equipoDtoSchema),
  valvulas: z.array(valvulaDtoSchema),
})
export type YacimientoTreeDto = z.infer<typeof yacimientoTreeDtoSchema>

export const yacimientoAssignmentDtoSchema = edgeRecordSchema.nullable()
export type YacimientoAssignmentDto = z.infer<typeof yacimientoAssignmentDtoSchema>

export const saveYacimientoInputSchema = z.object({
  name: z.string().trim().min(1),
  provincia: z.string().trim(),
  operadora: z.string().trim(),
  contratista: z.string().trim(),
})
export type SaveYacimientoInput = z.infer<typeof saveYacimientoInputSchema>

export const descendantKindSchema = z.enum(["planta", "equipo", "valvula"])
export const createDescendantInputSchema = z.object({
  kind: descendantKindSchema,
  parentId: edgeIdSchema,
  name: z.string().trim().min(1),
})
export type CreateDescendantInput = z.infer<typeof createDescendantInputSchema>

export const updateDescendantInputSchema = z.object({
  kind: descendantKindSchema,
  name: z.string().trim().min(1),
})
export type UpdateDescendantInput = z.infer<typeof updateDescendantInputSchema>

const serviceRequestRowSchema = edgeRecordSchema
const visitRowSchema = edgeRecordSchema
const workOrderRowSchema = edgeRecordSchema
const certificateRowSchema = edgeRecordSchema

export const serviceSelectionInputSchema = z.object({
  kind: z.enum(["yacimiento", "planta", "equipo", "valvula"]),
  id: edgeIdSchema,
})
export const createServiceRequestInputSchema = z.object({
  yacimientoId: edgeIdSchema,
  selections: z.array(serviceSelectionInputSchema).min(1),
})
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestInputSchema>

export const updateServiceRequestInputSchema = z.object({
  selections: z.array(serviceSelectionInputSchema).min(1),
})
export type UpdateServiceRequestInput = z.infer<typeof updateServiceRequestInputSchema>

export const serviceRequestDtoSchema = z.object({
  request: serviceRequestRowSchema,
  selected_valves: z.array(z.object({ id: edgeIdSchema, name: z.string() }).passthrough()),
})
export type ServiceRequestDto = z.infer<typeof serviceRequestDtoSchema>

export const visitDtoSchema = z.object({
  visit: visitRowSchema,
  work_orders: z.array(workOrderRowSchema),
})
export type VisitDto = z.infer<typeof visitDtoSchema>

export const visitTransitionDtoSchema = z.object({ visit: visitRowSchema }).or(visitDtoSchema)
export const scheduleVisitInputSchema = z.object({
  tallerMovilId: edgeIdSchema,
  startsAt: edgeTimestampSchema,
  endsAt: edgeTimestampSchema,
})
export type ScheduleVisitInput = z.infer<typeof scheduleVisitInputSchema>

export const updateWorkOrderInputSchema = z.object({
  outcome: z.enum(["evaluada", "no_evaluada"]),
  notEvaluatedReason: z.string().trim().min(1).optional(),
})
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderInputSchema>
export const workOrderDtoSchema = z.object({ work_order: workOrderRowSchema })

export const certificateDraftDtoSchema = z.object({
  certificate: certificateRowSchema,
  validation: z
    .object({ complete: z.boolean(), missing_fields: z.array(z.string()) })
    .passthrough(),
})
export type CertificateDraftDto = z.infer<typeof certificateDraftDtoSchema>

// Certificate payload is JSONB and has no stable frontend contract yet. Keep
// it opaque until the capture screen is specified; this still validates the
// route envelope and prevents unchecked response casts.
export const updateCertificateDraftInputSchema = z.record(z.string(), z.unknown())
export type UpdateCertificateDraftInput = z.infer<typeof updateCertificateDraftInputSchema>

export const finalizedCertificateDtoSchema = z.object({
  certificate: certificateRowSchema,
  context: z
    .object({
      yacimiento: yacimientoDtoSchema.nullable(),
      planta: plantaDtoSchema.nullable(),
      equipo: equipoDtoSchema.nullable(),
      valvula: valvulaDtoSchema.nullable(),
    })
    .passthrough(),
  snapshot: z.unknown().nullable(),
  validity: z
    .object({
      execution_date: z.string().nullable().optional(),
      valid_until: z.string().nullable().optional(),
      is_valid: z.boolean().optional(),
    })
    .passthrough(),
  signatures: z.array(z.unknown()),
  images: z.array(z.unknown()),
  client_logo: z.unknown().nullable(),
})

export const valveCertificateHistoryDtoSchema = z.object({
  current_certificate_id: edgeIdSchema.nullable().optional(),
  certificates: z.array(
    z
      .object({
        certificate: certificateRowSchema,
        status: z.enum(["pendiente", "vigente", "historico"]).optional(),
        is_current: z.boolean().optional(),
        validity: z
          .object({
            execution_date: z.string().nullable().optional(),
            valid_until: z.string().nullable().optional(),
            is_valid: z.boolean().optional(),
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough(),
  ),
})
export type ValveCertificateHistoryDto = z.infer<typeof valveCertificateHistoryDtoSchema>

export const visitSignatureInputSchema = z.object({
  party: z.enum(["tecnico", "cliente"]),
  signerName: z.string().trim().min(1),
  bucket: z.string().trim().min(1),
  objectPath: z.string().trim().min(1),
})
export type VisitSignatureInput = z.infer<typeof visitSignatureInputSchema>
export const visitSignatureDtoSchema = z.object({
  signature_id: edgeIdSchema,
  finalized_certificates: z.array(certificateRowSchema),
})

export const offlineOperationInputSchema = z.object({
  operationId: edgeIdSchema,
  kind: z.enum([
    "work_order_outcome",
    "start_certificate_draft",
    "update_certificate_draft",
    "submit_signature",
    "complete_visit",
  ]),
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.number().int().positive().optional(),
  dependencies: z.array(edgeIdSchema).optional(),
  deviceTimestamp: edgeTimestampSchema.optional(),
})
export const syncVisitInputSchema = z.object({
  deviceId: edgeIdSchema,
  operations: z.array(offlineOperationInputSchema),
})
export type SyncVisitInput = z.infer<typeof syncVisitInputSchema>

export const syncVisitDtoSchema = z.object({
  visit_id: edgeIdSchema,
  operations: z.array(
    z
      .object({
        operation_id: edgeIdSchema,
        estado: z.enum(["sincronizada", "conflicto", "pendiente"]),
        result: z.unknown().optional(),
        error_code: z.string().optional(),
        error_message: z.string().optional(),
      })
      .passthrough(),
  ),
})
export type SyncVisitDto = z.infer<typeof syncVisitDtoSchema>

export const offlineWorkingSetDtoSchema = z.object({
  visits: z.array(
    z
      .object({
        visit: visitRowSchema,
        work_orders: z.array(workOrderRowSchema),
        context: yacimientoTreeDtoSchema,
      })
      .passthrough(),
  ),
})
export type OfflineWorkingSetDto = z.infer<typeof offlineWorkingSetDtoSchema>
