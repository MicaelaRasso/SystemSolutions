"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { useEmpresa } from "@/lib/hooks/queries"

import { EmpresaForm } from "./empresa-form"
import { LogoUploader } from "./logo-uploader"

export function ClienteDatos({ id }: { id: string }) {
  const { data: empresa, isPending, isError } = useEmpresa(id)
  // El error ya lo muestra el encabezado del cliente.
  if (isError) return null
  if (isPending) return <Skeleton className="h-96 w-full max-w-3xl" />

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
      {/* key: reinicia el formulario si cambia la empresa cargada */}
      <EmpresaForm key={empresa.id} empresa={empresa} />
      <LogoUploader empresa={empresa} />
    </div>
  )
}
