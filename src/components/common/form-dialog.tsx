"use client"

import { useState } from "react"
import type { FieldValues, Path, UseFormReturn } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { EtiquetaCampo } from "./etiqueta-obligatoria"

/**
 * Diálogo con formulario. Se desmonta al cerrar, así cada apertura arranca con los valores iniciales.
 */
export function FormDialog({
  trigger,
  open: abiertoControlado,
  onOpenChange,
  titulo,
  descripcion,
  ancho = "sm:max-w-lg",
  children,
}: {
  /** Sin `trigger`, el diálogo se controla desde afuera con `open` y `onOpenChange`. */
  trigger?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  titulo: string
  descripcion?: string
  ancho?: string
  children: (cerrar: () => void) => React.ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const controlado = abiertoControlado !== undefined
  const open = controlado ? abiertoControlado : abierto
  function setOpen(valor: boolean) {
    if (!controlado) setAbierto(valor)
    onOpenChange?.(valor)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className={ancho}>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          {descripcion && <DialogDescription>{descripcion}</DialogDescription>}
        </DialogHeader>
        {open && children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  )
}

export function PieFormulario({
  pendiente,
  cerrar,
  crear,
}: {
  pendiente: boolean
  cerrar: () => void
  crear: boolean
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={cerrar} disabled={pendiente}>
        Cancelar
      </Button>
      <Button type="submit" disabled={pendiente}>
        {pendiente ? "Guardando…" : crear ? "Crear" : "Guardar"}
      </Button>
    </DialogFooter>
  )
}

export function CampoTexto<T extends FieldValues>({
  form,
  name,
  label,
  requerido = false,
  ...props
}: {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
  /** Marca la etiqueta con `*` y el control con `aria-required` (sin validación nativa). */
  requerido?: boolean
} & Omit<React.ComponentProps<typeof Input>, "form" | "name">) {
  const { error } = form.getFieldState(name, form.formState)
  return (
    <Field data-invalid={!!error}>
      <EtiquetaCampo htmlFor={name} requerido={requerido}>
        {label}
      </EtiquetaCampo>
      <Input
        id={name}
        aria-invalid={!!error}
        aria-required={requerido || undefined}
        {...props}
        {...form.register(name)}
      />
      <FieldError errors={[error]} />
    </Field>
  )
}
