import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { AdminDashboard, dashboardMonthBounds } from "./dashboard"
import { useEdgeAdminMetrics } from "@/lib/api/hooks"

vi.mock("@/lib/api/hooks", () => ({ useEdgeAdminMetrics: vi.fn() }))
vi.mock("@/components/admin/sync-conflicts-panel", () => ({
  SyncConflictsPanel: () => createElement("div", null, "Conflictos de sincronización"),
}))

describe("dashboard month selection", () => {
  it("defaults using the current Argentina calendar month across UTC midnight", () => {
    expect(dashboardMonthBounds(new Date("2026-03-01T02:59:59.000Z"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    })
    expect(dashboardMonthBounds(new Date("2026-03-01T03:00:00.000Z"))).toEqual({
      from: "2026-03-01",
      to: "2026-03-31",
    })
  })

  it("includes leap days in the selected calendar month", () => {
    expect(dashboardMonthBounds(new Date("2024-02-15T15:00:00.000Z"))).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    })
  })
})

describe("AdminDashboard metric states", () => {
  beforeEach(() => vi.clearAllMocks())

  it("shows loading placeholders and Argentina period inputs while metrics load", () => {
    vi.mocked(useEdgeAdminMetrics).mockReturnValue({
      isLoading: true,
      isError: false,
      data: undefined,
      error: null,
      refetch: vi.fn(),
    } as never)

    const markup = renderToStaticMarkup(createElement(AdminDashboard))

    expect(markup).toContain('aria-label="Cargando métricas"')
    expect(markup).toContain('aria-label="Desde"')
    expect(markup).toContain('aria-label="Hasta"')
    expect(markup).toContain("fecha calendario de Argentina")
  })

  it("renders each metric card and the empty state when all counts are zero", () => {
    vi.mocked(useEdgeAdminMetrics).mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        from: "2026-10-01",
        to: "2026-10-31",
        finalized_certificates: 0,
        completed_visits: 0,
        pending_certificates: 0,
        expiring_certificates: 0,
        unassigned_visits: 0,
      },
      error: null,
      refetch: vi.fn(),
    } as never)

    const markup = renderToStaticMarkup(createElement(AdminDashboard))

    expect(markup).toContain("Certificados finalizados")
    expect(markup).toContain("Visitas completadas")
    expect(markup).toContain("Certificados pendientes")
    expect(markup).toContain("Vencen en 30 días")
    expect(markup).toContain("Visitas sin Taller Móvil")
    expect(markup).toContain("Sin actividad en el período")
    expect(markup).toContain("octubre de 2026 al")
    expect(markup).toContain("octubre de 2026 (Argentina)")
  })

  it("shows an error state with the query retry action", () => {
    vi.mocked(useEdgeAdminMetrics).mockReturnValue({
      isLoading: false,
      isError: true,
      data: undefined,
      error: new Error("offline"),
      refetch: vi.fn(),
    } as never)

    expect(renderToStaticMarkup(createElement(AdminDashboard))).toContain("No se pudo cargar la información")
  })
})
