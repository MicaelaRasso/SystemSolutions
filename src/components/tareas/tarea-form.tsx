"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { FileUp, Paperclip, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import { CampoTexto } from "@/components/common/form-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { abrirAdjunto } from "@/lib/adjuntos"
import { TIPOS_TAREA } from "@/lib/domain/catalogos"
import { ESTADO_TAREA_LABEL } from "@/lib/domain/rules"
import { tareaSchema, type TareaInput } from "@/lib/domain/schemas"
import type { Adjunto, EstadoTarea } from "@/lib/domain/types"
import { hoyIso } from "@/lib/fechas"
import {
  INVALIDAR_TAREAS,
  mensajeError,
  useCatalogo,
  useServiceMutation,
  useTalleres,
} from "@/lib/hooks/queries"
import { services, type NuevaTarea, type TareaResumen } from "@/lib/services"

import { COLOR_SIN_TALLER } from "./badges"
import { UbicacionCascade, type Ubicacion } from "./ubicacion-cascade"

const SIN_TALLER = "__sin_asignar"
const ESTADOS = Object.keys(ESTADO_TAREA_LABEL) as EstadoTarea[]

function valoresIniciales(
  tarea?: TareaResumen,
  preset?: { fecha?: string; tallerId?: string },
): TareaInput {
  return {
    empresaId: tarea?.empresaId ?? "",
    yacimientoId: tarea?.yacimientoId ?? "",
    plantaId: tarea?.plantaId ?? "",
    equipoId: tarea?.equipoId ?? "",
    tallerId: tarea?.tallerId ?? preset?.tallerId ?? "",
    contacto: tarea?.contacto ?? "",
    telefono: tarea?.telefono ?? "",
    fechaSolicitud: tarea?.fechaSolicitud ?? hoyIso(),
    fechaEjecucion: tarea?.fechaEjecucion ?? preset?.fecha ?? "",
    horario: tarea?.horario ?? "",
    tipo: tarea?.tipo ?? TIPOS_TAREA[0],
    detalle: tarea?.detalle ?? "",
    pdRto: tarea?.pdRto ?? "",
    ordenTrabajo: tarea?.ordenTrabajo ?? "",
    condiciones: tarea?.condiciones ?? [],
    estado: tarea?.estado ?? "pendiente",
  }
}

const vacioAUndefined = (s: string) => (s.trim() ? s.trim() : undefined)

/** Alta y edición de tareas (RF-13, RF-14, RF-15). */
export function TareaForm({
  tarea,
  preset,
}: {
  tarea?: TareaResumen
  preset?: { fecha?: string; tallerId?: string }
}) {
  const router = useRouter()
  const editando = !!tarea
  const form = useForm<TareaInput>({
    resolver: zodResolver(tareaSchema),
    defaultValues: valoresIniciales(tarea, preset),
  })
  const { errors, isDirty } = form.formState

  const talleres = useTalleres()
  const condicionesCatalogo = useCatalogo("condicionesServicio")

  const [adjuntos, setAdjuntos] = useState<Adjunto[]>(tarea?.adjuntos ?? [])
  const [adjuntosCambiados, setAdjuntosCambiados] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const inputArchivo = useRef<HTMLInputElement>(null)

  const [empresaId, yacimientoId, plantaId, equipoId, tallerActual, condiciones] = useWatch({
    control: form.control,
    name: ["empresaId", "yacimientoId", "plantaId", "equipoId", "tallerId", "condiciones"],
  })

  const guardar = useServiceMutation(
    (data: TareaInput) => {
      const payload: NuevaTarea = {
        ...data,
        tallerId: data.tallerId || undefined,
        horario: vacioAUndefined(data.horario),
        pdRto: vacioAUndefined(data.pdRto),
        ordenTrabajo: vacioAUndefined(data.ordenTrabajo),
        contacto: data.contacto.trim(),
        telefono: data.telefono.trim(),
        detalle: data.detalle.trim(),
        adjuntos,
      }
      return tarea ? services.tareas.update(tarea.id, payload) : services.tareas.create(payload)
    },
    { invalidar: INVALIDAR_TAREAS },
  )

  function onSubmit(data: TareaInput) {
    guardar.mutate(data, {
      onSuccess: (t) => {
        if (editando) {
          toast.success("Tarea actualizada")
          form.reset({ ...data, estado: t.estado, tallerId: t.tallerId ?? "" })
          setAdjuntosCambiados(false)
        } else {
          toast.success(`Tarea creada · Solicitud N° ${t.nroSolicitud}`)
          router.push(`/admin/tareas/${t.id}`)
        }
      },
    })
  }

  function setUbicacion(u: Ubicacion) {
    ;(Object.keys(u) as (keyof Ubicacion)[]).forEach((k) =>
      form.setValue(k, u[k], { shouldDirty: true, shouldValidate: form.formState.isSubmitted }),
    )
  }

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = [...(e.target.files ?? [])]
    e.target.value = ""
    if (!archivos.length) return
    setSubiendo(true)
    try {
      const nuevos = await Promise.all(archivos.map((a) => services.tareas.subirAdjunto(a)))
      setAdjuntos((prev) => [...prev, ...nuevos])
      setAdjuntosCambiados(true)
    } catch (err) {
      toast.error(mensajeError(err))
    } finally {
      setSubiendo(false)
    }
  }

  const opcionesTaller = (talleres.data ?? []).filter((t) => t.activo || t.id === tarea?.tallerId)
  const opcionesCondiciones = [
    ...new Set([...(condicionesCatalogo.data?.map((o) => o.valor) ?? []), ...condiciones]),
  ]

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-4xl">
      <FieldGroup>
        <FieldSet>
          <FieldLegend>Ubicación del servicio</FieldLegend>
          <UbicacionCascade
            value={{ empresaId, yacimientoId, plantaId, equipoId }}
            onChange={setUbicacion}
            errores={{
              empresaId: errors.empresaId?.message,
              yacimientoId: errors.yacimientoId?.message,
              plantaId: errors.plantaId?.message,
              equipoId: errors.equipoId?.message,
            }}
          />
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Programación</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CampoTexto form={form} name="fechaSolicitud" label="Fecha de solicitud" type="date" />
            <CampoTexto form={form} name="fechaEjecucion" label="Fecha de ejecución" type="date" />
            <CampoTexto form={form} name="horario" label="Horario" type="time" />
            <Controller
              control={form.control}
              name="tallerId"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="tallerId">Taller móvil</FieldLabel>
                  <Select
                    value={field.value || SIN_TALLER}
                    onValueChange={(v) => field.onChange(v === SIN_TALLER ? "" : v)}
                  >
                    <SelectTrigger id="tallerId" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_TALLER}>
                        <span
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: COLOR_SIN_TALLER }}
                        />
                        Sin asignar
                      </SelectItem>
                      {opcionesTaller.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />
                          {t.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!tallerActual && (
                    <FieldDescription>Se puede asignar más adelante.</FieldDescription>
                  )}
                </Field>
              )}
            />
          </div>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Solicitud</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto form={form} name="contacto" label="Contacto que solicita" />
            <CampoTexto form={form} name="telefono" label="Teléfono" type="tel" />
            <Controller
              control={form.control}
              name="tipo"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="tipo">Tipo de tarea</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tipo" className="w-full">
                      <SelectValue placeholder="Seleccionar" />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set([...TIPOS_TAREA, field.value].filter(Boolean))].map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <CampoTexto form={form} name="ordenTrabajo" label="Orden de trabajo" />
              <CampoTexto form={form} name="pdRto" label="PD / RTO" />
            </div>
          </div>
          <Field data-invalid={!!errors.detalle}>
            <FieldLabel htmlFor="detalle">Detalle del trabajo</FieldLabel>
            <Textarea
              id="detalle"
              rows={3}
              aria-invalid={!!errors.detalle}
              {...form.register("detalle")}
            />
            <FieldError errors={[errors.detalle]} />
          </Field>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Condiciones del servicio</FieldLegend>
          <FieldDescription>Relevadas al tomar la solicitud.</FieldDescription>
          <Controller
            control={form.control}
            name="condiciones"
            render={({ field }) => (
              <div className="grid gap-2 sm:grid-cols-2">
                {opcionesCondiciones.map((c) => {
                  const id = `cond-${c}`
                  return (
                    <label key={c} htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={field.value.includes(c)}
                        onCheckedChange={(v) =>
                          field.onChange(
                            v === true ? [...field.value, c] : field.value.filter((x) => x !== c),
                          )
                        }
                      />
                      {c}
                    </label>
                  )
                })}
              </div>
            )}
          />
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Adjuntos</FieldLegend>
          <FieldDescription>Por ejemplo, el listado de válvulas en PDF.</FieldDescription>
          {adjuntos.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {adjuntos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <Paperclip className="size-4 text-muted-foreground" />
                  <button
                    type="button"
                    className="flex-1 truncate text-left hover:underline"
                    onClick={() => abrirAdjunto(a)}
                  >
                    {a.nombre}
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Quitar ${a.nombre}`}
                    onClick={() => {
                      setAdjuntos((prev) => prev.filter((x) => x.id !== a.id))
                      setAdjuntosCambiados(true)
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={inputArchivo}
            type="file"
            multiple
            accept="application/pdf,image/*,.xlsx,.xls,.doc,.docx"
            className="sr-only"
            onChange={subir}
            aria-label="Archivo adjunto"
          />
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={subiendo}
              onClick={() => inputArchivo.current?.click()}
            >
              <FileUp />
              {subiendo ? "Subiendo…" : "Adjuntar archivo"}
            </Button>
          </div>
        </FieldSet>

        {editando && (
          <Controller
            control={form.control}
            name="estado"
            render={({ field }) => (
              <Field className="max-w-xs">
                <FieldLabel htmlFor="estado">Estado</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="estado" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (
                      <SelectItem key={e} value={e}>
                        {ESTADO_TAREA_LABEL[e]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Sin taller queda “Sin asignar”; al asignarle uno pasa a “Asignada”.
                </FieldDescription>
              </Field>
            )}
          />
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={guardar.isPending || subiendo || (editando && !isDirty && !adjuntosCambiados)}
          >
            {guardar.isPending ? "Guardando…" : editando ? "Guardar cambios" : "Crear tarea"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (!editando) return router.back()
              form.reset()
              setAdjuntos(tarea.adjuntos)
              setAdjuntosCambiados(false)
            }}
            disabled={editando && !isDirty && !adjuntosCambiados}
          >
            {editando ? "Descartar" : "Cancelar"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
