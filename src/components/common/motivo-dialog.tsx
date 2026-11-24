"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

import { EtiquetaCampo } from "./etiqueta-obligatoria"
import { normalizarMotivo } from "./motivo-dialog-utils"

export type PedidoMotivo = {
  titulo: string
  /** Texto del campo; también es la pregunta que se le hace a la persona. */
  etiqueta: string
  descripcion?: string
  /** Texto del botón principal. */
  confirmar?: string
  destructivo?: boolean
}

/**
 * Reemplazo accesible de `window.prompt` para pedir un motivo obligatorio. Se usa con
 * `useMotivo`: `const motivo = await pedirMotivo({...})` devuelve el texto o `null` si se cancela.
 */
function MotivoDialog({
  pedido,
  onResolver,
}: {
  pedido: PedidoMotivo
  onResolver: (motivo: string | null) => void
}) {
  const [texto, setTexto] = useState("")
  const [error, setError] = useState(false)

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    // Los eventos de React suben por el portal: que no llegue al formulario que lo abrió.
    e.stopPropagation()
    const motivo = normalizarMotivo(texto)
    if (!motivo) {
      setError(true)
      return
    }
    onResolver(motivo)
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onResolver(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pedido.titulo}</DialogTitle>
          {pedido.descripcion && <DialogDescription>{pedido.descripcion}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={enviar} className="grid gap-4" noValidate>
          <Field data-invalid={error}>
            <EtiquetaCampo htmlFor="motivo-texto" requerido>
              {pedido.etiqueta}
            </EtiquetaCampo>
            <Textarea
              id="motivo-texto"
              value={texto}
              rows={3}
              required
              aria-invalid={error}
              aria-describedby={error ? "motivo-error" : undefined}
              onChange={(e) => {
                setTexto(e.target.value)
                if (error) setError(false)
              }}
            />
            {error && <FieldError id="motivo-error">Indique el motivo para continuar.</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onResolver(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant={pedido.destructivo ? "destructive" : "default"}>
              {pedido.confirmar ?? "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Pide un motivo con un diálogo propio. Devuelve `pedirMotivo` (promesa con el motivo ya recortado
 * o `null` si se cancela) y `dialogo`, que el componente debe renderizar en su JSX.
 */
export function useMotivo() {
  const [pedido, setPedido] = useState<PedidoMotivo | null>(null)
  const resolver = useRef<((motivo: string | null) => void) | null>(null)

  const terminar = useCallback((motivo: string | null) => {
    resolver.current?.(motivo)
    resolver.current = null
    setPedido(null)
  }, [])

  const pedirMotivo = useCallback(
    (nuevo: PedidoMotivo) =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null)
        resolver.current = resolve
        setPedido(nuevo)
      }),
    [],
  )

  // Si el componente se desmonta con el diálogo abierto, la promesa pendiente se cierra como cancelada.
  useEffect(() => () => resolver.current?.(null), [])

  const dialogo = pedido ? <MotivoDialog pedido={pedido} onResolver={terminar} /> : null
  return { pedirMotivo, dialogo }
}
