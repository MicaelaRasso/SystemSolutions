"use client"

import { Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { EmpresaDialog } from "@/components/clientes/empresa-dialog"
import { EtiquetaCampo } from "@/components/common/etiqueta-obligatoria"
import { EquipoDialog, PlantaDialog, YacimientoDialog } from "@/components/estructura/dialogs"
import { Field, FieldError } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useArbol, useEmpresas } from "@/lib/hooks/queries"

import {
  CREAR,
  NIVELES,
  elegirNivel,
  etiquetaCrear,
  opcionesDe,
  type Clave,
  type Ubicacion,
} from "./ubicacion-logica"

export type { Ubicacion } from "./ubicacion-logica"

/**
 * Opciones de un nivel. Con `crear` agrega al final, separada, la opción «+ Agregar …»; si la
 * lista está vacía queda como única opción (el desplegable vacío solo mide una fila).
 */
export function OpcionesNivel({
  opciones,
  crear,
}: {
  opciones: { id: string; label: string }[]
  crear: string | null
}) {
  return (
    <>
      {opciones.map((o) => (
        <SelectItem key={o.id} value={o.id}>
          {o.label}
        </SelectItem>
      ))}
      {opciones.length === 0 && !crear && (
        <div className="px-2 py-1.5 text-sm text-muted-foreground">Sin opciones</div>
      )}
      {crear && (
        <>
          {opciones.length > 0 && <SelectSeparator />}
          <SelectItem value={CREAR} className="font-medium text-primary focus:text-primary">
            <Plus />
            {crear}
          </SelectItem>
        </>
      )}
    </>
  )
}

/**
 * Selección encadenada cliente → yacimiento → planta → equipo.
 * Al cambiar un nivel se limpian los de abajo; si el siguiente tiene una sola opción, se elige sola.
 *
 * Con `permitirCrear`, cada desplegable de cliente, yacimiento y planta termina con una opción
 * «+ Agregar …» que abre un diálogo de alta sin tocar el valor ni el formulario que lo contiene;
 * al guardar, lo creado queda elegido.
 *
 * Con `disabled`, la ubicación se muestra pero no se puede cambiar (ni crear desde acá).
 */
export function UbicacionCascade({
  value,
  onChange,
  errores = {},
  permitirCrear = false,
  disabled = false,
}: {
  value: Ubicacion
  onChange: (v: Ubicacion) => void
  errores?: Partial<Record<Clave, string | undefined>>
  permitirCrear?: boolean
  disabled?: boolean
}) {
  const empresas = useEmpresas({ incluirInactivas: false })
  const arbol = useArbol(value.empresaId)
  const puedeCrear = permitirCrear && !disabled

  const [dialogo, setDialogo] = useState<Clave | null>(null)
  const pendiente = useRef<Clave | null>(null)
  const respaldo = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(respaldo.current), [])

  function elegir(clave: Clave, id: string) {
    onChange(elegirNivel(value, clave, id, arbol.data))
  }

  /** Lo recién creado queda elegido (y se limpian los niveles de abajo, como al elegir a mano). */
  function creado(clave: Clave, id: string) {
    setDialogo(null)
    elegir(clave, id)
  }

  // Abrir el diálogo mientras el desplegable se cierra hace que se disputen el foco y deja el
  // body con pointer-events bloqueados. Se espera a que Radix termine de cerrar y devuelva el
  // foco al campo (así el diálogo lo recuerda y se lo devuelve al cerrarse).
  function abrirPendiente() {
    clearTimeout(respaldo.current)
    const clave = pendiente.current
    pendiente.current = null
    if (clave) setDialogo(clave)
  }

  function pedirCrear(clave: Clave) {
    pendiente.current = clave
    // Respaldo por si Radix no llega a avisar el cierre.
    respaldo.current = setTimeout(abrirPendiente, 400)
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {NIVELES.map(({ clave, label, placeholder }, i) => {
          const opciones =
            clave === "empresaId"
              ? (empresas.data?.map((e) => ({ id: e.id, label: e.razonSocial })) ?? [])
              : opcionesDe(clave, value, arbol.data)
          const padre = i > 0 ? value[NIVELES[i - 1].clave] : "x"
          const cargando =
            clave === "empresaId" ? empresas.isPending : !!value.empresaId && arbol.isPending
          const error = errores[clave]
          const id = `ubicacion-${clave}`
          const crear = puedeCrear ? etiquetaCrear(clave, value) : null
          return (
            <Field key={clave} data-invalid={!!error}>
              {/* Los cuatro niveles son obligatorios en `tareaSchema`. */}
              <EtiquetaCampo htmlFor={id} requerido>
                {label}
              </EtiquetaCampo>
              <Select
                value={value[clave]}
                // Radix emite "" desde su <select> nativo oculto cuando el valor se fija por código
                // (autocompletado) antes de que existan las opciones: se ignora para no borrarlo.
                onValueChange={(v) => {
                  if (!v) return
                  if (v === CREAR) pedirCrear(clave)
                  else elegir(clave, v)
                }}
                disabled={disabled || !padre || cargando}
              >
                <SelectTrigger id={id} className="w-full" aria-invalid={!!error} aria-required>
                  <SelectValue placeholder={cargando ? "Cargando…" : placeholder} />
                </SelectTrigger>
                {/* Sin opciones, Radix no tiene un ítem contra el cual alinearse (item-aligned) y el
                    cartel se dibujaba en la esquina de la ventana: "popper" lo ancla al campo. */}
                <SelectContent
                  position={opciones.length === 0 ? "popper" : "item-aligned"}
                  onCloseAutoFocus={() => {
                    if (pendiente.current) setTimeout(abrirPendiente, 0)
                  }}
                >
                  <OpcionesNivel opciones={opciones} crear={crear} />
                </SelectContent>
              </Select>
              <FieldError errors={error ? [{ message: error }] : undefined} />
            </Field>
          )
        })}
      </div>

      {puedeCrear && (
        // Los diálogos viven en un portal, pero sus eventos suben por el árbol de React hasta el
        // <form> de la tarea: el envío de un alta no debe enviar la tarea.
        <div className="contents" onSubmit={(e) => e.stopPropagation()}>
          <EmpresaDialog
            open={dialogo === "empresaId"}
            onOpenChange={(abierto) => !abierto && setDialogo(null)}
            onCreated={(empresa) => creado("empresaId", empresa.id)}
          />
          <YacimientoDialog
            empresaId={value.empresaId}
            open={dialogo === "yacimientoId"}
            onOpenChange={(abierto) => !abierto && setDialogo(null)}
            onSaved={(id) => creado("yacimientoId", id)}
          />
          <PlantaDialog
            empresaId={value.empresaId}
            yacimientoId={value.yacimientoId}
            open={dialogo === "plantaId"}
            onOpenChange={(abierto) => !abierto && setDialogo(null)}
            onSaved={(id) => creado("plantaId", id)}
          />
          <EquipoDialog
            empresaId={value.empresaId}
            plantaId={value.plantaId}
            open={dialogo === "equipoId"}
            onOpenChange={(abierto) => !abierto && setDialogo(null)}
            onSaved={(id) => creado("equipoId", id)}
          />
        </div>
      )}
    </>
  )
}
