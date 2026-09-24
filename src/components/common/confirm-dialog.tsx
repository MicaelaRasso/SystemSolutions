"use client"

import { useState } from "react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/** Confirmación para acciones destructivas. Queda abierto mientras `onConfirm` está en curso. */
export function ConfirmDialog({
  trigger,
  titulo,
  descripcion,
  confirmar = "Eliminar",
  onConfirm,
}: {
  trigger: React.ReactNode
  titulo: string
  descripcion: React.ReactNode
  confirmar?: string
  onConfirm: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [pendiente, setPendiente] = useState(false)

  async function confirmarAccion() {
    setPendiente(true)
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      // El error ya se notificó (toast); se deja el diálogo abierto.
    } finally {
      setPendiente(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !pendiente && setOpen(o)}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{titulo}</AlertDialogTitle>
          <AlertDialogDescription>{descripcion}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirmarAccion} disabled={pendiente}>
            {pendiente ? "Procesando…" : confirmar}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
