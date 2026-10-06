import { z } from "zod"

/**
 * Browser-facing DTOs for the routes exposed by the direct Edge owners.
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
  estado: z.enum(["pendiente", "activa", "deshabilitada"]),
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
  clientId: edgeIdSchema.optional(),
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

/**
 * A catalog value captured in a certificate keeps both its stable identity and
 * the label shown to the Técnico. Legacy drafts may still contain the label as
 * a string; the union lets the reader remain backward compatible while new
 * capture flows use the structured value.
 */
export const certificateOptionSchema = z
  .object({
    id: edgeIdSchema,
    label: z.string().trim().min(1),
  })
  .strict()
export type CertificateOption = z.infer<typeof certificateOptionSchema>

export const certificateOptionValueSchema = z.union([
  certificateOptionSchema,
  z.string().trim().min(1),
])
export type CertificateOptionValue = z.infer<typeof certificateOptionValueSchema>

export const certificateTemplateFieldTypeSchema = z.enum([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "boolean",
])
export type CertificateTemplateFieldType = z.infer<typeof certificateTemplateFieldTypeSchema>

export const certificateTemplateFieldSchema = z
  .object({
    clave: z.string().trim().min(1),
    etiqueta: z.string().trim().min(1),
    tipo: certificateTemplateFieldTypeSchema,
    seccion: z.string().trim().min(1),
    orden: z.number().int().nonnegative(),
    obligatorio: z.boolean(),
    opciones: z.array(certificateOptionSchema).default([]),
  })
  .strict()

export const certificateTemplateSchema = z
  .object({
    id: edgeIdSchema,
    version: z.string().trim().min(1),
    estado: z.enum(["borrador", "activa", "historica"]),
    campos: z.array(certificateTemplateFieldSchema),
  })
  .passthrough()
export type CertificateTemplateDto = z.infer<typeof certificateTemplateSchema>
export const certificateTemplateListDtoSchema = z.array(certificateTemplateSchema)

export const certificateTemplateInputSchema = z
  .object({
    version: z.string().trim().min(1),
    campos: z.array(certificateTemplateFieldSchema),
  })
  .strict()
export type CertificateTemplateInput = z.infer<typeof certificateTemplateInputSchema>

export const certificateStandardOptionSchema = certificateOptionSchema.extend({
  nro_serie: z.string().optional(),
  vencimiento: z.string().optional(),
})

export const certificateCaptureCatalogsSchema = z.object({
  template: certificateTemplateSchema,
  maintenance: z.array(certificateOptionSchema),
  replacement_catalog_version: edgeIdSchema,
  replacement_parts: z.array(certificateOptionSchema),
  units: z.array(certificateOptionSchema),
  standards: z.array(certificateStandardOptionSchema),
})
export type CertificateCaptureCatalogsDto = z.infer<typeof certificateCaptureCatalogsSchema>

export const certificateReplacementPartsSchema = z
  .object({
    catalog_version: z.string().trim().min(1),
    items: z.array(certificateOptionValueSchema),
    otros: z.string().nullable().optional(),
  })
  .strict()

export const certificateEvidenceSchema = z
  .object({
    desarmada: z.unknown().nullable(),
    ensamblada_prueba: z.unknown().nullable(),
    placa_precinto: z.unknown().nullable(),
  })
  .strict()

/**
 * Canonical certificate capture contract. The database stores these sections
 * in separate columns, while this shape is the single browser-facing payload
 * used for draft updates. Template version is server-owned and is returned on
 * the certificate row rather than accepted as a client update field.
 */
export const certificatePayloadSchema = z
  .object({
    fecha_ejecucion: z.string().nullable().optional(),
    tecnico_ejecutor: z.string().nullable().optional(),
    datos_tecnicos: z.record(z.string(), z.unknown()).optional(),
    campos_personalizados: z.record(z.string(), z.unknown()).optional(),
    alcance_mantenimiento: z.array(certificateOptionValueSchema).optional(),
    repuestos: certificateReplacementPartsSchema.optional(),
    evidencia_fotografica: certificateEvidenceSchema.optional(),
    observaciones: z.string().nullable().optional(),
  })
  .strict()

const certificateRowSchema = edgeRecordSchema
  .extend({
    plantilla_version: z.string().min(1).optional(),
    plantilla_version_id: edgeIdSchema.nullable().optional(),
    plantilla_snapshot: z.record(z.string(), z.unknown()).optional(),
    contexto_captura: z.record(z.string(), z.unknown()).optional(),
    fecha_ejecucion: z.string().nullable().optional(),
    tecnico_ejecutor: z.string().nullable().optional(),
    datos_tecnicos: z.record(z.string(), z.unknown()).optional(),
    campos_personalizados: z.record(z.string(), z.unknown()).optional(),
    alcance_mantenimiento: z.array(certificateOptionValueSchema).optional(),
    repuestos: certificateReplacementPartsSchema.optional(),
    evidencia_fotografica: certificateEvidenceSchema.optional(),
    observaciones: z.string().nullable().optional(),
  })
  .passthrough()

export const operationStatusSchema = z.enum([
  "solicitada",
  "programada",
  "aceptada",
  "en_curso",
  "completada",
  "cancelada",
])
export type OperationStatus = z.infer<typeof operationStatusSchema>

const visitRowSchema = edgeRecordSchema
  .extend({ estado: operationStatusSchema.optional() })
  .passthrough()

export const workOrderDetailDtoSchema = edgeRecordSchema
  .extend({
    valvula_id: edgeIdSchema.optional(),
    visita_id: edgeIdSchema.optional(),
    estado: z.enum(["pendiente", "evaluada", "no_evaluada"]).optional(),
    no_evaluada_razon: z.string().nullable().optional(),
  })
  .passthrough()
export type WorkOrderDetailDto = z.infer<typeof workOrderDetailDtoSchema>
const workOrderRowSchema = workOrderDetailDtoSchema

/** Rich work-order projection returned only inside an operation detail. */
export const operationWorkOrderDetailDtoSchema = z
  .object({
    work_order: workOrderDetailDtoSchema,
    valve: valvulaDtoSchema,
    context: z
      .object({
        yacimiento: yacimientoDtoSchema,
        planta: plantaDtoSchema,
        equipo: equipoDtoSchema,
      })
      .strict(),
  })
  .strict()
export type OperationWorkOrderDetailDto = z.infer<typeof operationWorkOrderDetailDtoSchema>

export const serviceSelectionInputSchema = z.object({
  kind: z.enum(["yacimiento", "planta", "equipo", "valvula"]),
  id: edgeIdSchema,
})
export const createServiceRequestInputSchema = z.object({
  yacimientoId: edgeIdSchema,
  selections: z.array(serviceSelectionInputSchema).min(1),
})
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestInputSchema>
export const createAdministrativeServiceRequestInputSchema = createServiceRequestInputSchema.extend(
  {
    clientId: edgeIdSchema,
  },
)
export type CreateAdministrativeServiceRequestInput = z.infer<
  typeof createAdministrativeServiceRequestInputSchema
>

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
  work_orders: z.array(workOrderDetailDtoSchema),
})
export type VisitDto = z.infer<typeof visitDtoSchema>

export const pendingClientSignatureVisitDtoSchema = z.object({
  visit: visitRowSchema,
  yacimiento: z
    .object({
      id: edgeIdSchema,
      nombre: z.string(),
    })
    .passthrough(),
  work_orders: z.array(workOrderDetailDtoSchema),
  pending_certificates: z.array(certificateRowSchema),
  pending_certificate_count: z.number().int().positive(),
})
export type PendingClientSignatureVisitDto = z.infer<typeof pendingClientSignatureVisitDtoSchema>

export const pendingClientSignatureVisitsDtoSchema = z.object({
  visits: z.array(pendingClientSignatureVisitDtoSchema),
})
export type PendingClientSignatureVisitsDto = z.infer<typeof pendingClientSignatureVisitsDtoSchema>

export const visitTransitionDtoSchema = z.object({ visit: visitRowSchema }).or(visitDtoSchema)
export const scheduleVisitInputSchema = z.object({
  tallerMovilId: edgeIdSchema,
  startsAt: edgeTimestampSchema,
  endsAt: edgeTimestampSchema,
})
export type ScheduleVisitInput = z.infer<typeof scheduleVisitInputSchema>

export const visitAdministrationInputSchema = z.object({
  reason: z.string().trim().min(1),
})
export const visitAssignmentInputSchema = visitAdministrationInputSchema.extend({
  tallerMovilId: edgeIdSchema,
  startsAt: edgeTimestampSchema.nullable().optional(),
  endsAt: edgeTimestampSchema.nullable().optional(),
})
export type VisitAdministrationInput = z.infer<typeof visitAdministrationInputSchema>
export type VisitAssignmentInput = z.infer<typeof visitAssignmentInputSchema>

export const updateWorkOrderInputSchema = z.object({
  outcome: z.enum(["evaluada", "no_evaluada"]),
  notEvaluatedReason: z.string().trim().min(1).optional(),
})
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderInputSchema>
export const workOrderDtoSchema = z.object({ work_order: workOrderDetailDtoSchema })

export const certificateDraftDtoSchema = z.object({
  certificate: certificateRowSchema,
  validation: z
    .object({
      complete: z.boolean(),
      missing_fields: z.array(z.string()),
      invalid_fields: z.array(z.string()).optional(),
    })
    .passthrough(),
})
export type CertificateDraftDto = z.infer<typeof certificateDraftDtoSchema>

/** Partial updates retain the canonical field shape but remain compatible with
 * the existing PATCH semantics, where each section may be sent independently. */
export const updateCertificateDraftInputSchema = certificatePayloadSchema.partial()
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

export interface VisitSignatureUploadInput {
  party: "tecnico" | "cliente"
  captureMethod?: "pwa_tecnico" | "pwa_cliente_presencial" | "panel_cliente"
  signerName: string
  file: File
}
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
    "upload_photo",
    "capture_evidence",
    "upload_evidence",
    "finalize_certificate",
    "start_visit",
    "claim_visit",
    "complete_visit",
  ]),
  payload: z.record(z.string(), z.unknown()),
  idempotencyKey: edgeIdSchema.optional(),
  schemaVersion: z.number().int().positive().optional(),
  dependencies: z.array(edgeIdSchema).optional(),
  deviceTimestamp: edgeTimestampSchema.optional(),
  baseVersions: z.record(z.string(), z.number().int().nonnegative()).optional(),
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
        server_received_at: edgeTimestampSchema.optional(),
        server_acknowledged_at: edgeTimestampSchema.optional(),
      })
      .passthrough(),
  ),
  visit_acknowledgement: z
    .object({
      visit_id: edgeIdSchema,
      estado: z.enum(["sincronizada", "conflicto", "pendiente"]),
      server_received_at: edgeTimestampSchema,
      server_acknowledged_at: edgeTimestampSchema,
    })
    .passthrough()
    .optional(),
})
export type SyncVisitDto = z.infer<typeof syncVisitDtoSchema>

export const offlineClaimVisitDtoSchema = z.object({
  visit_id: edgeIdSchema,
  device_id: edgeIdSchema,
  claimed_at: edgeTimestampSchema,
  last_seen_at: edgeTimestampSchema,
})

export const offlineMediaUploadDtoSchema = z.object({
  media_id: edgeIdSchema,
  image_id: edgeIdSchema,
  bucket: z.string().min(1),
  object_path: z.string().min(1),
  content_type: z.string().min(1),
  server_received_at: edgeTimestampSchema,
})
export type OfflineMediaUploadDto = z.infer<typeof offlineMediaUploadDtoSchema>

export const offlineWorkingSetDtoSchema = z.object({
  certificate_catalogs: certificateCaptureCatalogsSchema.optional(),
  visits: z.array(
    z
      .object({
        visit: visitRowSchema,
        work_orders: z.array(workOrderRowSchema),
        context: yacimientoTreeDtoSchema,
        certificate_catalogs: certificateCaptureCatalogsSchema.optional(),
      })
      .passthrough(),
  ),
})
export type OfflineWorkingSetDto = z.infer<typeof offlineWorkingSetDtoSchema>

// Frontend: Empresa/Usuario/Taller/Persona/Catálogo -> the administrative
// capability functions. These DTOs intentionally preserve snake_case at the
// transport boundary; view-model mapping belongs in the adapter below.
export const clientDtoSchema = z
  .object({
    id: edgeIdSchema,
    razon_social: z.string(),
    nombre: z.string().optional(),
    cuit: z.string(),
    contacto: z.string(),
    telefono: z.string(),
    email: z.string(),
    direccion: z.string(),
    logo_url: z
      .union([z.string(), z.object({ bucket: z.string(), path: z.string() })])
      .nullable()
      .optional(),
    aviso_vencimiento: z.boolean(),
    activo: z.boolean(),
    creado_en: edgeTimestampSchema,
    yacimientos: z.number().int().nonnegative(),
    valvulas: z.number().int().nonnegative(),
    usuarios: z.number().int().nonnegative(),
  })
  .passthrough()
export type ClientDto = z.infer<typeof clientDtoSchema>

export const accountDtoSchema = z
  .object({
    id: edgeIdSchema,
    email: z.string(),
    nombre: z.string(),
    apellido: z.string(),
    rol: z.enum(["cliente", "taller_movil", "administrador_regular", "super_administrador"]),
    activo: z.boolean(),
    estado: z.enum(["pendiente", "activa", "deshabilitada"]),
    creado_en: edgeTimestampSchema,
  })
  .passthrough()
export type AccountDto = z.infer<typeof accountDtoSchema>

export const workshopDtoSchema = z
  .object({
    id: edgeIdSchema,
    nombre: z.string(),
    color: z.string(),
    activo: z.boolean(),
    estado_cuenta: z.enum(["pendiente", "activa", "deshabilitada"]).nullable().optional(),
    usuario_id: edgeIdSchema.nullable().optional(),
    email: z.string(),
  })
  .passthrough()

export const personDtoSchema = z
  .object({
    id: edgeIdSchema,
    nombre: z.string(),
    apellido: z.string(),
    dni: z.string(),
    activo: z.boolean(),
  })
  .passthrough()

export const catalogOptionDtoSchema = z
  .object({
    id: edgeIdSchema,
    lista: z.string(),
    valor: z.string(),
    orden: z.number().int(),
    activo: z.boolean(),
  })
  .passthrough()

export const testStandardDtoSchema = z
  .object({
    id: edgeIdSchema,
    nombre: z.string(),
    nro_serie: z.string(),
    vencimiento: z.string(),
    activo: z.boolean(),
  })
  .passthrough()

export const staffingDtoSchema = z
  .object({
    taller_id: edgeIdSchema,
    fecha: z.string(),
    persona_ids: z.array(edgeIdSchema),
  })
  .passthrough()

/** Canonical operation summary shared by list and detail reads. */
export const operationSummarySchema = z
  .object({
    id: edgeIdSchema,
    solicitud_id: edgeIdSchema,
    numero_solicitud: z.number().int(),
    estado: operationStatusSchema,
    starts_at: edgeTimestampSchema,
    ends_at: edgeTimestampSchema,
    cliente: z
      .object({
        id: edgeIdSchema,
        nombre: z.string(),
      })
      .strict(),
    yacimiento: z
      .object({
        id: edgeIdSchema,
        nombre: z.string(),
      })
      .strict(),
    taller_movil: z
      .object({
        id: edgeIdSchema,
        nombre: z.string(),
      })
      .strict()
      .nullable(),
    ordenes: z
      .object({
        total: z.number().int().nonnegative(),
        pendientes: z.number().int().nonnegative(),
        evaluadas: z.number().int().nonnegative(),
        no_evaluadas: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
export type OperationSummary = z.infer<typeof operationSummarySchema>

/** DTO returned by `GET /operations`. */
export const operationListDtoSchema = z
  .object({
    items: operationSummarySchema.array(),
    total: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    has_more: z.boolean(),
  })
  .strict()
export type OperationListDto = z.infer<typeof operationListDtoSchema>

/** DTO returned by `GET /operations/:operationId`. */
export const operationDetailDtoSchema = z
  .object({
    operation: operationSummarySchema,
    visit: visitDtoSchema,
    request: serviceRequestDtoSchema,
    work_orders: operationWorkOrderDetailDtoSchema.array(),
  })
  .strict()
export type OperationDetailDto = z.infer<typeof operationDetailDtoSchema>

export const auditEventDtoSchema = z
  .object({
    id: edgeIdSchema,
    actor_cuenta_id: edgeIdSchema.nullable().optional(),
    actor_email: z.string().optional(),
    actor_rol: z.string().optional(),
    accion: z.string(),
    tipo_objetivo: z.string(),
    objetivo_id: edgeIdSchema.nullable().optional(),
    resultado: z.enum(["exitoso", "fallido"]),
    recibida_en: edgeTimestampSchema,
    evento_dispositivo_en: edgeTimestampSchema.nullable().optional(),
    identidad_correlacion: z.string().nullable().optional(),
    resumen_cambio: z.record(z.string(), z.unknown()),
    identificadores_relacionados: z.record(z.string(), z.unknown()),
  })
  .passthrough()
export type AuditEventDto = z.infer<typeof auditEventDtoSchema>
export const auditListDtoSchema = z.object({
  items: auditEventDtoSchema.array(),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  has_more: z.boolean(),
})
export const adminMetricsDtoSchema = z.object({
  from: z.string(),
  to: z.string(),
  finalized_certificates: z.number(),
  completed_visits: z.number(),
  pending_certificates: z.number(),
  expiring_certificates: z.number(),
  unassigned_visits: z.number(),
})
export const adminCertificateListDtoSchema = z.object({
  items: z.array(certificateRowSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
})
export const adminCertificateDetailDtoSchema = z.object({
  certificate: certificateRowSchema,
  history: certificateRowSchema.array(),
  audit_events: auditEventDtoSchema.array(),
})

// Response-schema names remain as aliases for callers that consumed the first
// adapter draft; the canonical surface is expressed by the DTO names above.
export const operationListResponseSchema = operationListDtoSchema
export type OperationListResponse = OperationListDto
export const operationDetailResponseSchema = operationDetailDtoSchema
export type OperationDetailResponse = OperationDetailDto
