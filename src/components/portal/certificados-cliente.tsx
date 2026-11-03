"use client"

import { useQueries } from "@tanstack/react-query"
import { FileCheck2, Search } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { EmptyState, ErrorState } from "@/components/common/states"
import { TablaResponsive, type ColumnaTabla } from "@/components/common/tabla-responsive"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  pd: string
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
    id: "pd",
    encabezado: "Parte Diario",
    celda: (f) => <span className="font-mono text-xs">{f.pd}</span>,
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

function resolverPdCertificado(cert: Record<string, unknown>): string {
  const directo = cert.pd ?? cert.parte_diario ?? cert.parte_diario_codigo
  if (typeof directo === "string" && directo.trim()) return directo.trim()
  const personalizados =
    cert.campos_personalizados &&
    typeof cert.campos_personalizados === "object" &&
    !Array.isArray(cert.campos_personalizados)
      ? (cert.campos_personalizados as Record<string, unknown>)
      : {}
  const desdePersonalizado = personalizados.pd_rto ?? personalizados.pd ?? personalizados.parte_diario
  if (typeof desdePersonalizado === "string" && desdePersonalizado.trim()) {
    return desdePersonalizado.trim()
  }
  return "—"
}

/**
 * Certificados de las Válvulas del alcance del Cliente con acceso a la vista previa.
 * Los vencidos no se abren (RN-06); la descarga se decide en la vista (RN-04, RN-05).
 */
export function CertificadosCliente() {
  const [filtroPd, setFiltroPd] = useState("")
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
  const valvulasMap = useMemo(() => {
    const map = new Map<string, { id: string; tag: string; ubicacion: string }>()
    for (const v of valvulas) {
      map.set(v.id, v)
    }
    return map
  }, [valvulas])

  const historiales = useQueries({
    queries: valvulas.map((valvula) => ({
      queryKey: certificateQueryKeys.valveHistory(valvula.id),
      queryFn: () => edgeApi.certificates.valveHistory(valvula.id),
    })),
  })

  const filas = historiales.flatMap((query, i) => {
    const valvulaId = valvulas[i]?.id
    const valvula = (valvulaId ? valvulasMap.get(valvulaId) : undefined) ?? valvulas[i]
    if (!valvula) return []
    return (query.data?.certificates ?? [])
      .filter((entrada) => entrada.certificate?.estado !== "borrador")
      .map((entrada) => ({ entrada, valvula }))
  })

  const cargando =
    yacimientos.isPending ||
    (arboles.length > 0 && arboles.some((q) => q.isPending)) ||
    (historiales.length > 0 && historiales.some((q) => q.isPending))

  const error =
    yacimientos.error ??
    (arboles.length > 0 && arboles.every((q) => q.isError)
      ? arboles.find((q) => q.error)?.error
      : null)

  const reintentar = () => {
    void yacimientos.refetch()
    arboles.forEach((q) => void q.refetch())
    historiales.forEach((q) => void q.refetch())
  }

  const safeFormatNro = (numero: number, fecha: string | null) => {
    if (!fecha || isNaN(Date.parse(fecha))) return String(numero)
    try {
      return formatNroCertificado(numero, fecha)
    } catch {
      return String(numero)
    }
  }

  const filasTabla: FilaCertificado[] = filas
    .filter(({ valvula }) => Boolean(valvula?.id))
    .map(({ entrada, valvula }) => {
      const cert = entrada.certificate ?? {}
      const id = String(cert.id ?? "")
      const fecha = typeof cert.fecha_ejecucion === "string" ? cert.fecha_ejecucion : null
      const numero =
        typeof cert.numero === "number"
          ? safeFormatNro(cert.numero, fecha)
          : "Sin número"
      return {
        id,
        numero,
        pd: resolverPdCertificado(cert),
        tag: valvula.tag ?? "—",
        ubicacion: valvula.ubicacion ?? "—",
        estado: entrada.status ?? (cert.estado === "finalizado" ? "historico" : "pendiente"),
        vencido: cert.estado === "finalizado" && entrada.validity?.is_valid === false,
        ejecucion: fechaCorta(entrada.validity?.execution_date ?? fecha),
        vence: fechaCorta(entrada.validity?.valid_until),
        href: `/portal/certificados/${encodeURIComponent(id)}?valvula=${encodeURIComponent(valvula.id)}`,
      }
    })

  const termino = filtroPd.trim().toLowerCase()
  const filasFiltradas = termino
    ? filasTabla.filter(
        (f) =>
          f.pd.toLowerCase().includes(termino) ||
          f.numero.toLowerCase().includes(termino) ||
          f.tag.toLowerCase().includes(termino) ||
          f.ubicacion.toLowerCase().includes(termino),
      )
    : filasTabla

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
      <CardContent className="space-y-4">
        {error ? (
          <ErrorState error={error} onRetry={reintentar} />
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
          <>
            <div className="max-w-md space-y-1.5">
              <Label htmlFor="portal-filtro-pd">Filtrar por Parte Diario, válvula o certificado</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="portal-filtro-pd"
                  value={filtroPd}
                  onChange={(event) => setFiltroPd(event.target.value)}
                  placeholder="Ej. PD1234, PSV-2752 o 26-02-0014…"
                  className="pl-8"
                />
              </div>
            </div>
            {filasFiltradas.length === 0 ? (
              <EmptyState
                icono={FileCheck2}
                titulo="Sin coincidencias"
                descripcion="No se encontraron certificados para el Parte Diario o criterio buscado."
                className="py-6"
              />
            ) : (
              <TablaResponsive
                filas={filasFiltradas}
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
          </>
        )}
      </CardContent>
    </Card>
  )
}
