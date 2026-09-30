"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ErrorState } from "@/components/common/states"
import { Skeleton } from "@/components/ui/skeleton"
import { useEdgeContext } from "@/lib/api/hooks"
import { useEmpresa } from "@/lib/hooks/queries"

import { LogoUploader } from "./logo-uploader"

/** Read-only Cliente profile plus the permitted self-service logo mutation. */
export function ClienteEmpresaPortal() {
  const context = useEdgeContext()
  const empresa = useEmpresa(context.data?.cuenta_id ?? "")

  if (context.isError) return <ErrorState error={context.error} />
  if (context.isPending || empresa.isPending) return <Skeleton className="h-96 w-full max-w-3xl" />
  if (empresa.isError) return <ErrorState error={empresa.error} onRetry={() => void empresa.refetch()} />

  const fields = [
    ["Razón social", empresa.data.razonSocial],
    ["CUIT", empresa.data.cuit],
    ["Contacto", empresa.data.contacto],
    ["Teléfono", empresa.data.telefono],
    ["Email", empresa.data.email],
    ["Dirección", empresa.data.direccion],
  ] as const

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card>
        <CardHeader>
          <CardTitle>Datos de la empresa</CardTitle>
          <CardDescription>Estos datos son administrados por System Solutions.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {fields.map(([label, value]) => (
            <div className="rounded-md border bg-muted/20 p-3" key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-sm font-medium">{value || "—"}</p>
            </div>
          ))}
        </CardContent>
      </Card>
      <LogoUploader empresa={empresa.data} />
    </div>
  )
}
