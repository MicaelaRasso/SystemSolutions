export const actorHeaders = ({
  actorId,
  correlationId,
  functionName,
}: {
  actorId: string
  correlationId: string
  functionName: string
}): HeadersInit => ({
  "x-systemsolutions-actor-id": actorId,
  "x-systemsolutions-correlation-id": correlationId,
  "x-systemsolutions-function": functionName,
})
