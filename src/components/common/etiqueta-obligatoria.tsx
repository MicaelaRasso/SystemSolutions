import { FieldLabel } from "@/components/ui/field"

/**
 * Marca visual de campo obligatorio. Es `aria-hidden`: no cambia el nombre accesible de la
 * etiqueta (los lectores de pantalla lo anuncian por el `aria-required` del control).
 */
export function MarcaObligatoria() {
  return (
    <span aria-hidden="true" className="-ml-1 text-destructive">
      *
    </span>
  )
}

/** `FieldLabel` que agrega la marca `*` cuando el campo es obligatorio. */
export function EtiquetaCampo({
  requerido = false,
  children,
  ...props
}: React.ComponentProps<typeof FieldLabel> & { requerido?: boolean }) {
  return (
    <FieldLabel {...props}>
      {children}
      {requerido && <MarcaObligatoria />}
    </FieldLabel>
  )
}
