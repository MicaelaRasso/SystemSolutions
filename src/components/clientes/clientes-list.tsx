"use client"

import { BellOff, BellRing, Building2, Plus, Search } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { EstadoActivoBadge } from "@/components/certificados/badges"
import { PageHeader } from "@/components/common/page-header"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

      <div className="flex flex-wrap items-center gap-4">
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
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="hidden md:table-cell">Contacto</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Yacimientos</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Válvulas</TableHead>
                <TableHead className="hidden text-right lg:table-cell">Usuarios</TableHead>
                <TableHead className="hidden text-center sm:table-cell">Aviso</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-10 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                : data.map((e) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/admin/clientes/${e.id}`)}
                    >
                      <TableCell>
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
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div>{e.contacto}</div>
                        <div className="text-xs text-muted-foreground">{e.telefono}</div>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {e.yacimientos}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {e.valvulas}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {e.usuarios}
                      </TableCell>
                      <TableCell className="hidden text-center sm:table-cell">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex">
                              {e.avisoVencimiento ? (
                                <BellRing className="size-4 text-primary" aria-label="Con aviso" />
                              ) : (
                                <BellOff
                                  className="size-4 text-muted-foreground"
                                  aria-label="Sin aviso"
                                />
                              )}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {e.avisoVencimiento
                              ? "Recibe aviso de vencimiento por email"
                              : "No recibe aviso de vencimiento"}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>
                        <EstadoActivoBadge activo={e.activo} />
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  )
}
