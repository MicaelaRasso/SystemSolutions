"use client"

import { BellOff, BellRing, Building2, Plus, Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { EstadoActivoBadge } from "@/components/certificados/badges"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { FilaTarjeta, TablaResponsive } from "@/components/common/tabla-responsive"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useEmpresas } from "@/lib/hooks/queries"

import { EmpresaLogo } from "./empresa-logo"

export function ClientesList() {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState("")
  const [incluirInactivas, setIncluirInactivas] = useState(false)
  const q = useDebouncedValue(busqueda)
  const { data, isPending, isError, error, refetch } = useEmpresas({ q, incluirInactivas })

  return (
    <>
      <PageHeader
        titulo="Clientes"
        descripcion="Empresas cliente, su estructura de yacimientos y los usuarios con acceso al portal."
        acciones={
          <Button asChild>
            <Link href="/admin/clientes/nuevo">
              <Plus />
              Nuevo cliente
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por razón social, CUIT o contacto"
            className="pl-8"
            aria-label="Buscar clientes"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="inactivas" checked={incluirInactivas} onCheckedChange={setIncluirInactivas} />
          <Label htmlFor="inactivas" className="font-normal">
            Mostrar inactivos
          </Label>
        </div>
      </div>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !isPending && data.length === 0 ? (
        <EmptyState
          icono={Building2}
          titulo={q ? "No hay clientes que coincidan" : "Todavía no hay clientes"}
          descripcion={
            q ? "Probá con otro término de búsqueda." : "Cargá el primer cliente para empezar."
          }
        />
      ) : isPending ? (
        <div className="space-y-3" aria-busy>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : (
        <TablaResponsive
          filas={data}
          clave={(e) => e.id}
          descripcion="Clientes"
          onFila={(e) => router.push(`/admin/clientes/${e.id}`)}
          columnas={[
            {
              id: "cliente",
              encabezado: "Cliente",
              enTarjeta: "oculta",
              celda: (e) => (
                <div className="flex items-center gap-3">
                  <EmpresaLogo logoUrl={e.logoUrl} nombre={e.razonSocial} />
                  <div className="min-w-0">
                    <Link
                      href={`/admin/clientes/${e.id}`}
                      className="font-medium hover:underline"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      {e.razonSocial}
                    </Link>
                    <div className="text-xs text-muted-foreground">CUIT {e.cuit}</div>
                  </div>
                </div>
              ),
            },
            {
              id: "contacto",
              encabezado: "Contacto",
              enTarjeta: "oculta",
              celda: (e) => (
                <>
                  <div>{e.contacto}</div>
                  <div className="text-xs text-muted-foreground">{e.telefono}</div>
                </>
              ),
            },
            {
              id: "yacimientos",
              encabezado: "Yacimientos",
              className: "text-right tabular-nums",
              enTarjeta: "oculta",
              celda: (e) => e.yacimientos,
            },
            {
              id: "valvulas",
              encabezado: "Válvulas",
              className: "text-right tabular-nums",
              enTarjeta: "oculta",
              celda: (e) => e.valvulas,
            },
            {
              id: "usuarios",
              encabezado: "Usuarios",
              className: "hidden text-right tabular-nums lg:table-cell",
              enTarjeta: "oculta",
              celda: (e) => e.usuarios,
            },
            {
              id: "aviso",
              encabezado: "Aviso",
              className: "text-center",
              enTarjeta: "oculta",
              celda: (e) => (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      {e.avisoVencimiento ? (
                        <BellRing className="size-4 text-primary" aria-label="Con aviso" />
                      ) : (
                        <BellOff className="size-4 text-muted-foreground" aria-label="Sin aviso" />
                      )}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {e.avisoVencimiento
                      ? "Recibe aviso de vencimiento por email"
                      : "No recibe aviso de vencimiento"}
                  </TooltipContent>
                </Tooltip>
              ),
            },
            {
              id: "estado",
              encabezado: "Estado",
              enTarjeta: "oculta",
              celda: (e) => <EstadoActivoBadge activo={e.activo} />,
            },
          ]}
          tarjeta={(e) => (
            <Link href={`/admin/clientes/${e.id}`} className="block rounded-lg">
              <FilaTarjeta
                titulo={
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <EmpresaLogo logoUrl={e.logoUrl} nombre={e.razonSocial} />
                      <div className="min-w-0">
                        <div>{e.razonSocial}</div>
                        <div className="text-xs font-normal text-muted-foreground">
                          CUIT {e.cuit}
                        </div>
                      </div>
                    </div>
                    <EstadoActivoBadge activo={e.activo} />
                  </div>
                }
                campos={[
                  { etiqueta: "Contacto", valor: `${e.contacto} · ${e.telefono}` },
                  { etiqueta: "Yacimientos", valor: e.yacimientos },
                  { etiqueta: "Válvulas", valor: e.valvulas },
                  { etiqueta: "Usuarios", valor: e.usuarios },
                  {
                    etiqueta: "Aviso",
                    valor: e.avisoVencimiento
                      ? "Recibe aviso de vencimiento"
                      : "No recibe aviso de vencimiento",
                  },
                ]}
              />
            </Link>
          )}
        />
      )}
    </>
  )
}
