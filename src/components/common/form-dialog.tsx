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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/**
 * Diálogo con formulario. Se desmonta al cerrar, así cada apertura arranca con los valores iniciales.
 */
export function FormDialog({
  trigger,
  titulo,
  descripcion,
  ancho = "sm:max-w-lg",
  children,
}: {
  trigger: React.ReactNode
  titulo: string
  descripcion?: string
  ancho?: string
  children: (cerrar: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
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
  ...props
}: {
  form: UseFormReturn<T>
  name: Path<T>
  label: string
} & Omit<React.ComponentProps<typeof Input>, "form" | "name">) {
  const { error } = form.getFieldState(name, form.formState)
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} aria-invalid={!!error} {...props} {...form.register(name)} />
      <FieldError errors={[error]} />
    </Field>
  )
}
