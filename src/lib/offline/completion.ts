type CompletionWorkOrder = {
  id: string
  estado?: string
  certificate_id?: string | null
  certificate?: Record<string, unknown> | null
}

type CompletionOperation = {
  operationId: string
  kind: string
  payload: Record<string, unknown>
  createdAt: string
  estado: string
}

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const present = (value: unknown) =>
  value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "")

function certificateComplete(certificate: Record<string, unknown>, templateSnapshot: unknown) {
  const technical = objectValue(certificate.datos_tecnicos)
  const tests = objectValue(technical.ensayos ?? technical.tests)
  const custom = objectValue(certificate.campos_personalizados)
  const requiredTemplateFields = objectValue(templateSnapshot).campos
  const requiredCustomFields = Array.isArray(requiredTemplateFields)
    ? requiredTemplateFields.filter((field) => {
        const value = objectValue(field)
        return value.obligatorio === true
      })
    : []
  return present(certificate.fecha_ejecucion) &&
    present(certificate.tecnico_ejecutor) &&
    ["sp_inicial", "sp_apertura", "presion_cierre"].every((key) => {
      const test = objectValue(tests[key])
      return present(test.valor) && Number.isFinite(Number(test.valor)) && present(test.unidad)
    }) &&
    present(tests.patron) &&
    requiredCustomFields.every((field) => present(custom[String(objectValue(field).clave)]))
}

export function visitCompletionBlocker(
  workOrders: CompletionWorkOrder[],
  operations: CompletionOperation[],
): string | undefined {
  const pending = operations.filter((operation) => operation.estado !== "sincronizada")
  const queuedOutcomes = pending
    .filter((operation) => operation.kind === "work_order_outcome")
    .sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.operationId.localeCompare(right.operationId)
    )
  const queuedDrafts = pending.filter((operation) => operation.kind === "start_certificate_draft")

  for (const workOrder of workOrders) {
    const outcome = queuedOutcomes
      .filter((operation) => operation.payload.work_order_id === workOrder.id)
      .at(-1)?.payload.outcome ?? workOrder.estado

    if (outcome !== "evaluada" && outcome !== "no_evaluada")
      return "Todas las Órdenes de trabajo deben tener un resultado antes de completar la visita."

    const draftOperation = queuedDrafts
      .filter((operation) => operation.payload.work_order_id === workOrder.id)
      .at(-1)
    const certificateId = workOrder.certificate_id ??
      (typeof draftOperation?.payload.certificate_id === "string" ? draftOperation.payload.certificate_id : undefined)
    const hasCertificate = Boolean(certificateId || workOrder.certificate)
    if (outcome === "evaluada" && !hasCertificate)
      return "Cada Orden de trabajo evaluada necesita un Borrador de certificado antes de completar la visita."
    if (outcome === "no_evaluada" && hasCertificate)
      return "Una Orden de trabajo no evaluada no puede tener un Certificado."
    if (outcome === "evaluada") {
      const updates = pending
        .filter((operation) =>
          operation.kind === "update_certificate_draft" &&
          operation.payload.certificate_id === certificateId,
        )
        .sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.operationId.localeCompare(right.operationId),
        )
      const data = updates.reduce<Record<string, unknown>>(
        (current, operation) => ({ ...current, ...objectValue(operation.payload.data) }),
        objectValue(workOrder.certificate),
      )
      const templateSnapshot = draftOperation?.payload.template_snapshot ??
        objectValue(workOrder.certificate).plantilla_snapshot
      if (!certificateComplete(data, templateSnapshot))
        return "Completá y guardá los datos obligatorios del Certificado antes de completar la visita."
    }
  }

  return undefined
}
