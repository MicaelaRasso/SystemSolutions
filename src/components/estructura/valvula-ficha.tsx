"use client"

import { FileCheck2 } from "lucide-react"

import { FirmaBadge, VigenciaBadge } from "@/components/certificados/badges"
import { EmptyState, ErrorState } from "@/components/common/states"
import { TablaResponsive } from "@/components/common/tabla-responsive"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Cargando } from "@/components/common/cargando"
import { formatNroCertificado, vigencia } from "@/lib/domain/rules"
import type { Valvula } from "@/lib/domain/types"
import { fmtFecha } from "@/lib/format"
import { useCertificadosValvula, useValvula } from "@/lib/hooks/queries"

/** Campos que se relevan en campo si no se conocen al alta (RF-08). */
const RELEVABLES_EN_CAMPO = new Set<keyof Valvula>(["nroSerie", "modelo", "marca", "precinto"])

const CAMPOS: { key: keyof Valvula; label: string; unidad?: string }[] = [
  { key: "tag", label: "TAG" },
  { key: "precinto", label: "Precinto" },
  { key: "servicio", label: "Servicio" },
  { key: "marca", label: "Marca" },
  { key: "nroSerie", label: "N° de serie" },
  { key: "modelo", label: "Modelo" },
  { key: "tipo", label: "Tipo" },
  { key: "pv", label: "PV" },
  { key: "diamEntrada", label: "Ø Entrada / #" },
  { key: "diamSalida", label: "Ø Salida / #" },
  { key: "rosca", label: "Rosca" },
  { key: "presionOperacion", label: "P. operación", unidad: "kg/cm²" },
  { key: "temperaturaOperacion", label: "T° operación", unidad: "°C" },
]

export function ValvulaFicha({ valvula }: { valvula: Valvula }) {
  const detalle = useValvula(valvula.id)
  const ficha = detalle.data ?? valvula

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos de la válvula</CardTitle>
          <CardDescription>
            Se precargan en cada certificado; el técnico los confirma o completa en campo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {CAMPOS.map(({ key, label, unidad }) => {
              const valor = ficha[key]
              const vacio = valor === undefined || valor === ""
              return (
                <div key={key} className="space-y-0.5">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">
                    {!vacio ? (
                      <span className="rounded bg-field px-1.5 py-0.5">
                        {String(valor)}
                        {unidad && ` ${unidad}`}
                      </span>
                    ) : RELEVABLES_EN_CAMPO.has(key) ? (
                      <Badge variant="outline" className="border-dashed font-normal">
                        A relevar en campo
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </dd>
                </div>
              )
            })}
          </dl>
          {ficha.notas && <p className="mt-4 rounded-lg bg-muted/60 p-3 text-sm">{ficha.notas}</p>}
        </CardContent>
      </Card>

      <HistorialCertificados valvulaId={ficha.id} />
    </div>
  )
}

function HistorialCertificados({ valvulaId }: { valvulaId: string }) {
  const { data, isPending, isError, error, refetch } = useCertificadosValvula(valvulaId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Historial de certificados</CardTitle>
        <CardDescription>
          Una válvula puede tener más de un certificado en el año si hubo recalibración.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isPending ? (
          <Cargando variante="linea" texto="Cargando certificados…" />
        ) : data.length === 0 ? (
          <EmptyState
            icono={FileCheck2}
            titulo="Sin certificados"
            descripcion="Los certificados aparecen acá cuando el taller los sincroniza desde campo."
            className="py-8"
          />
        ) : (
          <TablaResponsive
            filas={data}
            clave={(c) => c.id}
            descripcion="Certificados de la válvula"
            columnas={[
              {
                id: "certificado",
                encabezado: "Certificado",
                className: "font-mono text-xs font-medium",
                enTarjeta: "titulo",
                celda: (c) =>
                  c.fechaEjecucion
                    ? formatNroCertificado(c.nro, c.fechaEjecucion)
                    : c.nro > 0
                      ? `Certificado ${c.nro}`
                      : "Pendiente de numeración",
              },
              {
                id: "ejecucion",
                encabezado: "Ejecución",
                celda: (c) => (c.fechaEjecucion ? fmtFecha(c.fechaEjecucion) : "Pendiente"),
              },
              {
                id: "vence",
                encabezado: "Vence",
                celda: (c) =>
                  c.fechaEjecucion ? fmtFecha(vigencia(c.fechaEjecucion).vence) : "Pendiente",
              },
              {
                id: "vigencia",
                encabezado: "Vigencia",
                celda: (c) =>
                  c.fechaEjecucion ? (
                    <VigenciaBadge fechaEjecucion={c.fechaEjecucion} />
                  ) : (
                    <Badge variant="outline">Pendiente</Badge>
                  ),
              },
              { id: "firma", encabezado: "Firma", celda: (c) => <FirmaBadge cert={c} /> },
              {
                id: "archivo",
                encabezado: "Archivo",
                className:
                  "hidden max-w-64 truncate font-mono text-xs text-muted-foreground xl:table-cell",
                celda: (c) => c.nombreArchivo || "—",
              },
            ]}
          />
        )}
      </CardContent>
    </Card>
  )
}
