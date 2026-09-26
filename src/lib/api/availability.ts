export type CapabilityAvailabilityStatus = "available" | "partial" | "unavailable"

export type CapabilityAvailability = {
  readonly status: CapabilityAvailabilityStatus
  readonly reason: string
}

export const capabilityAvailability = {
  clients: {
    status: "unavailable",
    reason: "No supported Edge route exists yet.",
  },
  accounts: {
    status: "unavailable",
    reason: "The account scope decision and identity-admin routes are not implemented.",
  },
  mobileWorkshops: {
    status: "unavailable",
    reason: "No supported Edge route exists yet.",
  },
  technicians: {
    status: "unavailable",
    reason: "No supported Edge route exists yet.",
  },
  catalogs: {
    status: "unavailable",
    reason: "Catalog administration is not resolved by the current domain decisions.",
  },
  staffing: {
    status: "unavailable",
    reason: "No supported Edge route exists yet.",
  },
  operations: {
    status: "available",
    reason:
      "Offers only GET /operations and GET /operations/:visitId as a read-only projection; mutations remain in Solicitudes, Visitas, and Órdenes.",
  },
  evidence: {
    status: "unavailable",
    reason: "The Edge-mediated evidence upload contract is not implemented.",
  },
} as const satisfies Record<string, CapabilityAvailability>

export type BlockedCapability = keyof typeof capabilityAvailability
