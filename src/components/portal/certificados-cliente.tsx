"use client"

import { useQueries } from "@tanstack/react-query"
import { FileCheck2 } from "lucide-react"
import Link from "next/link"
import { useMemo } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { TablaResponsive, type ColumnaTabla } from "@/components/common/tabla-responsive"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Cargando } from "@/components/common/cargando"
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

type FilaCertificado = {
  id: string
  numero: string
  tag: string
  ubicacion: string
  estado: keyof typeof ESTADO_LABEL
  vencido: boolean
  ejecucion: string
  vence: string
  href: string
}

function EstadoCertificado({ fila }: { fila: FilaCertificado }) {
  return (
    <Badge
      variant={fila.vencido ? "outline" : fila.estado === "vigente" ? "default" : "secondary"}
    >
      {fila.vencido ? "Vencido" : ESTADO_LABEL[fila.estado]}
    </Badge>
  )
}

/** Tabla en escritorio y tarjetas en celular y tablet vertical (patrón `TablaResponsive`). */
const COLUMNAS: ColumnaTabla<FilaCertificado>[] = [
  {
    id: "numero",
    encabezado: "Certificado",
    celda: (f) => <span className="font-mono text-xs">{f.numero}</span>,
    enTarjeta: "titulo",
  },
  {
    id: "valvula",
    encabezado: "Válvula",
    celda: (f) => <span className="font-medium">{f.tag}</span>,
    enTarjeta: "titulo",
  },
  {
    id: "ubicacion",
    encabezado: "Ubicación",
    celda: (f) => <span className="text-sm text-muted-foreground">{f.ubicacion}</span>,
  },
  { id: "estado", encabezado: "Estado", celda: (f) => <EstadoCertificado fila={f} /> },
  {
    id: "ejecucion",
    encabezado: "Ejecución",
    celda: (f) => <span className="tabular-nums">{f.ejecucion}</span>,
  },
  {
    id: "vence",
    encabezado: "Vence",
    celda: (f) => <span className="tabular-nums">{f.vence}</span>,
  },
]

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

  const filasTabla: FilaCertificado[] = filas.map(({ entrada, valvula }) => {
    const cert = entrada.certificate
    const id = String(cert.id)
    const fecha = typeof cert.fecha_ejecucion === "string" ? cert.fecha_ejecucion : null
    const numero =
      typeof cert.numero === "number"
        ? fecha
          ? formatNroCertificado(cert.numero, fecha)
          : String(cert.numero)
        : "Sin número"
    return {
      id,
      numero,
      tag: valvula.tag,
      ubicacion: valvula.ubicacion,
      estado: entrada.status ?? (cert.estado === "finalizado" ? "historico" : "pendiente"),
      vencido: cert.estado === "finalizado" && entrada.validity?.is_valid === false,
      ejecucion: fechaCorta(entrada.validity?.execution_date ?? fecha),
      vence: fechaCorta(entrada.validity?.valid_until),
      href: `/portal/certificados/${encodeURIComponent(id)}?valvula=${encodeURIComponent(valvula.id)}`,
    }
  })

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
          <TablaResponsive
            filas={filasTabla}
            clave={(f) => f.id}
            descripcion="Certificados"
            columnas={COLUMNAS}
            acciones={(f) =>
              f.vencido ? (
                <span className="text-xs text-muted-foreground">No disponible</span>
              ) : (
                <Button asChild variant="outline" className="max-sm:flex-1">
                  <Link href={f.href}>Ver certificado</Link>
                </Button>
              )
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
