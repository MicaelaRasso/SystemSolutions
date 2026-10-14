"use client"

import { useQueries } from "@tanstack/react-query"
import { FileCheck2 } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Cargando } from "@/components/common/cargando"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { edgeApi } from "@/lib/api"
import { certificateQueryKeys } from "@/lib/api/certificates"
import { hierarchyQueryKeys } from "@/lib/api/hierarchy"
import { useEdgeYacimientos } from "@/lib/api/hooks"
import { formatNroCertificado } from "@/lib/domain/rules"

const ESTADO_LABEL = { pendiente: "Pendiente de firma", vigente: "Vigente", historico: "Histórico" }

function fechaCorta(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "—"
  const [a, m, d] = value.slice(0, 10).split("-")
  return `${d}/${m}/${a}`
}

/**
 * Certificados de las Válvulas del alcance del Cliente con acceso a la vista previa.
 * Los vencidos no se abren (RN-06); la descarga se decide en la vista (RN-04, RN-05).
 */
export function CertificadosCliente() {
  const yacimientos = useEdgeYacimientos()
  const arboles = useQueries({
    queries: (yacimientos.data ?? []).map((yacimiento) => ({
      queryKey: hierarchyQueryKeys.tree(yacimiento.id),
      queryFn: () => edgeApi.hierarchy.tree(yacimiento.id),
    })),
  })
  const valvulas = useMemo(
    () =>
      arboles.flatMap(({ data: arbol }) =>
        arbol
          ? arbol.plantas.flatMap((planta) =>
              planta.equipos.flatMap((equipo) =>
                equipo.valvulas.map((valvula) => ({
                  id: valvula.id,
                  tag: valvula.tag,
                  ubicacion: `${arbol.nombre} · ${planta.nombre} · ${equipo.nombre}`,
                })),
              ),
            )
          : [],
      ),
    [arboles],
  )
  const historiales = useQueries({
    queries: valvulas.map((valvula) => ({
      queryKey: certificateQueryKeys.valveHistory(valvula.id),
      queryFn: () => edgeApi.certificates.valveHistory(valvula.id),
    })),
  })
  const filas = historiales.flatMap((query, i) =>
    (query.data?.certificates ?? []).map((entrada) => ({ entrada, valvula: valvulas[i] })),
  )
  const cargando =
    yacimientos.isPending ||
    arboles.some((q) => q.isPending) ||
    historiales.some((q) => q.isPending)
  const error =
    yacimientos.error ??
    arboles.find((q) => q.error)?.error ??
    historiales.find((q) => q.error)?.error

  return (
    <Card>
      <CardHeader>
        <CardTitle>Historial de certificados</CardTitle>
        <CardDescription>
          Abra un certificado para verlo con el formato del modelo SYS. La descarga en PDF se
          habilita cuando está firmado por System Solutions y por su empresa, y mientras esté
          vigente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <ErrorState error={error} onRetry={() => void yacimientos.refetch()} />
        ) : cargando ? (
          <Cargando texto="Cargando certificados…" />
        ) : filas.length === 0 ? (
          <EmptyState
            icono={FileCheck2}
            titulo="Sin certificados"
            descripcion="Todavía no hay certificados para los Yacimientos de su cuenta."
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
                  <TableHead>Ejecución</TableHead>
                  <TableHead>Vence</TableHead>
                  <TableHead>
                    <span className="sr-only">Acciones</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map(({ entrada, valvula }) => {
                  const cert = entrada.certificate
                  const id = String(cert.id)
                  const fecha =
                    typeof cert.fecha_ejecucion === "string" ? cert.fecha_ejecucion : null
                  const numero =
                    typeof cert.numero === "number"
                      ? fecha
                        ? formatNroCertificado(cert.numero, fecha)
                        : String(cert.numero)
                      : "Sin número"
                  const estado =
                    entrada.status ?? (cert.estado === "finalizado" ? "historico" : "pendiente")
                  const vencido =
                    cert.estado === "finalizado" && entrada.validity?.is_valid === false
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-mono text-xs">{numero}</TableCell>
                      <TableCell className="font-medium">{valvula.tag}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {valvula.ubicacion}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            vencido ? "outline" : estado === "vigente" ? "default" : "secondary"
                          }
                        >
                          {vencido ? "Vencido" : ESTADO_LABEL[estado]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fechaCorta(entrada.validity?.execution_date ?? fecha)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fechaCorta(entrada.validity?.valid_until)}
                      </TableCell>
                      <TableCell className="text-right">
                        {vencido ? (
                          <span className="text-xs text-muted-foreground">No disponible</span>
                        ) : (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={`/portal/certificados/${encodeURIComponent(id)}?valvula=${encodeURIComponent(valvula.id)}`}
                            >
                              Ver certificado
                            </Link>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
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
