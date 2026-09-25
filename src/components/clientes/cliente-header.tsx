"use client"

import { ChevronLeft } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { EstadoActivoBadge } from "@/components/certificados/badges"
import { ErrorState } from "@/components/common/states"
import { Skeleton } from "@/components/ui/skeleton"
import { useEmpresa } from "@/lib/hooks/queries"
import { cn } from "@/lib/utils"

import { EmpresaLogo } from "./empresa-logo"

export function ClienteHeader({ id }: { id: string }) {
  const pathname = usePathname()
  const { data: empresa, isPending, isError, error, refetch } = useEmpresa(id)

  const tabs = [
    { href: `/admin/clientes/${id}`, label: "Datos" },
    { href: `/admin/clientes/${id}/estructura`, label: "Estructura" },
    { href: `/admin/clientes/${id}/usuarios`, label: "Usuarios" },
  ]

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />

  return (
    <div className="space-y-4">
      <Link
        href="/admin/clientes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Clientes
      </Link>
      <div className="flex items-center gap-4">
        {isPending ? (
          <>
            <Skeleton className="size-14 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-40" />
            </div>
          </>
        ) : (
          <>
            <EmpresaLogo
              logoUrl={empresa.logoUrl}
              nombre={empresa.razonSocial}
              className="size-14 rounded-xl"
            />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{empresa.razonSocial}</h1>
                <EstadoActivoBadge activo={empresa.activo} />
              </div>
              <p className="text-sm text-muted-foreground">
                CUIT {empresa.cuit} · {empresa.contacto} · {empresa.telefono}
              </p>
            </div>
          </>
        )}
      </div>
      <nav className="flex gap-1 border-b" aria-label="Secciones del cliente">
        {tabs.map((t) => {
          const activo = pathname === t.href
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={activo ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                activo
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
