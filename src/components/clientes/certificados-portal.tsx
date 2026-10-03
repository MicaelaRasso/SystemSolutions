"use client"

import { useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { FileCheck2 } from "lucide-react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { CertificateExpandedDetails } from "@/components/certificados/certificate-expanded-details"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useEdgeYacimientos } from "@/lib/api/hooks"
import { certificateQueryKeys } from "@/lib/api/certificates"
import { edgeApi } from "@/lib/api"
import { hierarchyQueryKeys } from "@/lib/api/hierarchy"

type Tree = Awaited<ReturnType<typeof edgeApi.hierarchy.tree>>

function value(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const current = record[key]
    if (typeof current === "string" || typeof current === "number") return String(current)
  }
  return "—"
}

export function CertificadosPortal() {
  const yacimientos = useEdgeYacimientos()
  const trees = useQueries({
    queries: (yacimientos.data ?? []).map((yacimiento) => ({
      queryKey: hierarchyQueryKeys.tree(yacimiento.id),
      queryFn: () => edgeApi.hierarchy.tree(yacimiento.id),
    })),
  })
  const valves = useMemo(
    () =>
      trees.flatMap((query) => {
        const tree = query.data as Tree | undefined
        if (!tree) return []
        const raw = tree as unknown as {
          yacimiento?: { nombre?: string }
          plantas?: {
            id: string
            nombre: string
            equipos: {
              id: string
              nombre: string
              valvulas: { id: string; nombre?: string; tag?: string }[]
            }[]
          }[]
        }
        return (raw.plantas ?? []).flatMap((planta) =>
          planta.equipos.flatMap((equipo) =>
            equipo.valvulas.map((valvula) => ({
              ...valvula,
              planta: planta.nombre,
              equipo: equipo.nombre,
              yacimiento: raw.yacimiento?.nombre ?? "—",
            })),
          ),
        )
      }),
    [trees],
  )
  const histories = useQueries({
    queries: valves.map((valve) => ({
      queryKey: certificateQueryKeys.valveHistory(valve.id),
      queryFn: () => edgeApi.certificates.valveHistory(valve.id),
    })),
  })
  const records = histories.flatMap((query, index) =>
    (query.data?.certificates ?? []).map((entry) => ({ entry, valve: valves[index] })),
  )
  const loading =
    yacimientos.isPending ||
    trees.some((query) => query.isPending) ||
    histories.some((query) => query.isPending)
  const error =
    yacimientos.error ??
    trees.find((query) => query.error)?.error ??
    histories.find((query) => query.error)?.error

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de certificados</CardTitle>
        <CardDescription>
          Los certificados finalizados conservan su número, contexto de Válvula, vigencia e
          historial. Los pendientes no reemplazan al certificado vigente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState error={error} onRetry={() => void yacimientos.refetch()} />
        ) : loading ? (
          <Skeleton className="h-32 w-full" />
        ) : records.length === 0 ? (
          <EmptyState
            icono={FileCheck2}
            titulo="Sin certificados"
            descripcion="Todavía no hay certificados disponibles para los Yacimientos de tu cuenta."
            className="py-8"
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>Certificado</TableHead>
                  <TableHead>Válvula</TableHead>
                  <TableHead>Ubicación</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha de ejecución</TableHead>
                  <TableHead>Vence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map(({ entry, valve }) => {
                  const certificate = entry.certificate as Record<string, unknown>
                  const validity = entry.validity as Record<string, unknown> | null | undefined
                  const status =
                    entry.status ??
                    (certificate.estado === "pendiente"
                      ? "pendiente"
                      : certificate.estado === "finalizado"
                        ? "finalizado"
                        : entry.is_current
                          ? "vigente"
                          : "histórico")
                  return (
                    <>
                      <TableRow key={String(certificate.id)}>
                        <TableCell className="font-mono text-xs">
                          {value(certificate, "numero_certificado", "numero", "nro")}
                        </TableCell>
                        <TableCell>
                          {value(valve as Record<string, unknown>, "tag", "nombre", "id")}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {valve.yacimiento} · {valve.planta} · {valve.equipo}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              status === "pendiente"
                                ? "secondary"
                                : status === "vigente" || status === "finalizado"
                                  ? "default"
                                  : "outline"
                            }
                          >
                            {status}
                          </Badge>
                        </TableCell>
                        <TableCell>{value(validity ?? {}, "execution_date")}</TableCell>
                        <TableCell>{value(validity ?? {}, "valid_until")}</TableCell>
                      </TableRow>
                      <TableRow key={`${String(certificate.id)}-details`}>
                        <TableCell colSpan={6}>
                          <details>
                            <summary className="cursor-pointer text-sm font-medium">
                              Ver datos ampliados
                            </summary>
                            <div className="pt-4">
                              <CertificateExpandedDetails certificate={certificate} />
                            </div>
                          </details>
                        </TableCell>
                      </TableRow>
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
