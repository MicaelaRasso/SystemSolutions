"use client"

import { FormDialog } from "@/components/common/form-dialog"
import type { Empresa } from "@/lib/domain/types"

import { EmpresaForm } from "./empresa-form"

/** Alta de un cliente dentro de un diálogo controlado: no navega y devuelve el cliente creado. */
export function EmpresaDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (empresa: Empresa) => void
}) {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      titulo="Nuevo cliente"
      descripcion="Empresa cliente que solicita el servicio."
      ancho="sm:max-w-2xl"
    >
      {(cerrar) => <EmpresaForm dialogo={{ cerrar, onCreated }} />}
    </FormDialog>
  )
}
