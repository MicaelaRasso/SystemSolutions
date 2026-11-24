"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { FileUp, Paperclip, TriangleAlert, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { toast } from "sonner"

import { ValvulaDialog } from "@/components/estructura/dialogs"
import { DatePicker } from "@/components/common/date-picker"
import { EtiquetaCampo } from "@/components/common/etiqueta-obligatoria"
import { CampoTexto } from "@/components/common/form-dialog"
import { useMotivo } from "@/components/common/motivo-dialog"
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { abrirAdjunto } from "@/lib/adjuntos"
import { TIPOS_TAREA } from "@/lib/domain/catalogos"
import { ESTADO_TAREA_LABEL, contactoPropuesto, horaFinPropuesta } from "@/lib/domain/rules"
import { tareaSchema, type TareaInput } from "@/lib/domain/schemas"
import type { Adjunto, EstadoTarea } from "@/lib/domain/types"
import { hoyIso } from "@/lib/fechas"
import {
  INVALIDAR_TAREAS,
  guardarSolicitudYVisita,
  guardarTarea,
  mensajeError,
  subirAdjunto,
  usaSupabase,
  useArbol,
  useCatalogo,
  useEmpresas,
  useServiceMutation,
  useTalleres,
} from "@/lib/hooks/queries"
import type { OperationRead } from "@/lib/hooks/queries"
import type { NuevaTarea, TareaResumen } from "@/lib/services"

import { COLOR_SIN_TALLER } from "./badges"
import { convertirOperacionATarea } from "./tarea-sheet"
import { UbicacionCascade, type Ubicacion } from "./ubicacion-cascade"

const SIN_TALLER = "__sin_asignar"
const ESTADOS = Object.keys(ESTADO_TAREA_LABEL) as EstadoTarea[]

function esOperacion(value: TareaResumen | OperationRead | undefined): value is OperationRead {
  return !!value && "operation" in value
}

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
    // Fin estimado: el guardado o inicio + 1 h (el usuario lo puede cambiar).
    horaFin: tarea?.horaFin ?? horaFinPropuesta(tarea?.horario || "08:00"),
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
  operation,
  preset,
}: {
  tarea?: TareaResumen
  operation?: Parameters<typeof guardarSolicitudYVisita>[0]
  preset?: { fecha?: string; tallerId?: string }
}) {
  const router = useRouter()
  const supabase = usaSupabase()
  const { pedirMotivo, dialogo: dialogoMotivo } = useMotivo()
  const editando = !!tarea
  const form = useForm<TareaInput>({
    resolver: zodResolver(tareaSchema),
    defaultValues: valoresIniciales(tarea, preset),
  })
  const { errors, isDirty } = form.formState

  const talleres = useTalleres()
  // Misma consulta que la cascada de ubicación: comparte la caché y no suma pedidos.
  const empresas = useEmpresas({ incluirInactivas: false })
  const condicionesCatalogo = useCatalogo("condicionesServicio")

  const [adjuntos, setAdjuntos] = useState<Adjunto[]>(tarea?.adjuntos ?? [])
  const [adjuntosCambiados, setAdjuntosCambiados] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const inputArchivo = useRef<HTMLInputElement>(null)

  const [empresaId, yacimientoId, plantaId, equipoId, tallerActual, condiciones, fechaSolicitud] =
    useWatch({
      control: form.control,
      name: [
        "empresaId",
        "yacimientoId",
        "plantaId",
        "equipoId",
        "tallerId",
        "condiciones",
        "fechaSolicitud",
      ],
    })

  // D2: un equipo sin válvulas no puede ser parte de una tarea (el backend lo rechaza).
  const arbol = useArbol(empresaId)
  const equipoSinValvulas =
    !operation && !!equipoId && !!arbol.data
      ? arbol.data
          .flatMap((y) => y.plantas.flatMap((p) => p.equipos))
          .some((e) => e.id === equipoId && e.valvulas.length === 0)
      : false

  const guardar = useServiceMutation<TareaInput, TareaResumen | OperationRead | undefined>(
    async (data: TareaInput) => {
      const payload: NuevaTarea = {
        ...data,
        tallerId: data.tallerId || undefined,
        horario: vacioAUndefined(data.horario),
        horaFin: vacioAUndefined(data.horaFin ?? ""),
        pdRto: vacioAUndefined(data.pdRto),
        ordenTrabajo: vacioAUndefined(data.ordenTrabajo),
        contacto: data.contacto.trim(),
        telefono: data.telefono.trim(),
        detalle: data.detalle.trim(),
        adjuntos,
      }
      if (supabase && operation) {
        const assignmentChanged =
          (payload.tallerId || undefined) !== operation.operation.taller_movil?.id
        if (assignmentChanged) {
          const reason = await pedirMotivo({
            titulo: "Cambio de asignación",
            etiqueta: "Motivo del cambio de asignación de la visita",
            confirmar: "Guardar cambios",
          })
          if (!reason) throw new Error("Indica el motivo del cambio de asignación")
          return guardarSolicitudYVisita(operation, payload, reason)
        }
      }
      return supabase ? guardarSolicitudYVisita(operation, payload) : guardarTarea(tarea, payload)
    },
    { invalidar: INVALIDAR_TAREAS },
  )

  function onSubmit(data: TareaInput) {
    guardar.mutate(data, {
      onSuccess: (resultado) => {
        const t = esOperacion(resultado)
          ? convertirOperacionATarea(resultado)
          : supabase
            ? undefined
            : resultado
        if (editando) {
          toast.success("Tarea actualizada")
          if (t) form.reset({ ...data, estado: t.estado, tallerId: t.tallerId ?? "" })
          setAdjuntosCambiados(false)
        } else {
          toast.success(t ? `Tarea creada · Solicitud N° ${t.nroSolicitud}` : "Solicitud creada")
          router.push(t ? `/admin/tareas/${t.id}` : "/admin/tareas")
        }
      },
    })
  }

  function setUbicacion(u: Ubicacion) {
    const cambioCliente = u.empresaId !== form.getValues("empresaId")
    ;(Object.keys(u) as (keyof Ubicacion)[]).forEach((k) =>
      form.setValue(k, u[k], { shouldDirty: true, shouldValidate: form.formState.isSubmitted }),
    )
    if (!cambioCliente || !u.empresaId) return
    const cliente = empresas.data?.find((e) => e.id === u.empresaId)
    const propuesta = contactoPropuesto(cliente, {
      contacto: form.getValues("contacto"),
      telefono: form.getValues("telefono"),
    })
    ;(Object.keys(propuesta) as (keyof typeof propuesta)[]).forEach((k) =>
      form.setValue(k, propuesta[k] ?? "", {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      }),
    )
  }

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = [...(e.target.files ?? [])]
    e.target.value = ""
    if (!archivos.length) return
    setSubiendo(true)
    try {
      const nuevos = await Promise.all(archivos.map((a) => subirAdjunto(a)))
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
            permitirCrear
            disabled={!!operation}
            errores={{
              empresaId: errors.empresaId?.message,
              yacimientoId: errors.yacimientoId?.message,
              plantaId: errors.plantaId?.message,
              equipoId: errors.equipoId?.message,
            }}
          />
          {equipoSinValvulas && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              <p className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                Este equipo no tiene válvulas cargadas. Cargá al menos una para poder crear la
                tarea.
              </p>
              {/* Los diálogos viven en un portal, pero sus eventos suben hasta el <form> de la
                  tarea: el envío de un alta no debe enviar la tarea. */}
              <div className="contents" onSubmit={(e) => e.stopPropagation()}>
                <ValvulaDialog
                  empresaId={empresaId}
                  equipoId={equipoId}
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      Cargar válvulas
                    </Button>
                  }
                />
              </div>
            </div>
          )}
          {operation && (
            <p className="text-sm text-muted-foreground">
              La ubicación y las válvulas de una tarea existente no se modifican desde la
              programación.
            </p>
          )}
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend>Programación</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Controller
              control={form.control}
              name="fechaSolicitud"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <EtiquetaCampo htmlFor="fechaSolicitud" requerido>
                    Fecha de solicitud
                  </EtiquetaCampo>
                  <DatePicker
                    id="fechaSolicitud"
                    aria-invalid={fieldState.invalid}
                    aria-required
                    {...field}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="fechaEjecucion"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <EtiquetaCampo htmlFor="fechaEjecucion" requerido>
                    Fecha de ejecución
                  </EtiquetaCampo>
                  {/* El esquema exige que no sea anterior a la fecha de solicitud. */}
                  <DatePicker
                    id="fechaEjecucion"
                    min={fechaSolicitud}
                    aria-invalid={fieldState.invalid}
                    aria-required
                    {...field}
                  />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Field data-invalid={!!errors.horario}>
              <FieldLabel htmlFor="horario">Hora de inicio</FieldLabel>
              <Input
                id="horario"
                type="time"
                aria-invalid={!!errors.horario}
                {...form.register("horario", {
                  // Al cambiar el inicio se vuelve a proponer el fin estimado (inicio + 1 h).
                  onChange: (event: { target: { value: string } }) =>
                    form.setValue("horaFin", horaFinPropuesta(event.target.value || "08:00"), {
                      shouldDirty: true,
                      shouldValidate: form.formState.isSubmitted,
                    }),
                })}
              />
              <FieldError errors={[errors.horario]} />
            </Field>
            <Field data-invalid={!!errors.horaFin}>
              <FieldLabel htmlFor="horaFin">Hora de fin estimada</FieldLabel>
              <Input
                id="horaFin"
                type="time"
                aria-invalid={!!errors.horaFin}
                {...form.register("horaFin")}
              />
              <FieldDescription>
                Reserva el equipo hasta esa hora. No cierra la visita: la completa el técnico.
              </FieldDescription>
              <FieldError errors={[errors.horaFin]} />
            </Field>
            <Controller
              control={form.control}
              name="tallerId"
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="tallerId">Taller móvil</FieldLabel>
                  <Select
                    value={field.value || SIN_TALLER}
                    // Radix emite "" cuando el valor se fija por código: no debe desasignar el taller.
                    onValueChange={(v) => v && field.onChange(v === SIN_TALLER ? "" : v)}
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
            <CampoTexto form={form} name="contacto" label="Contacto que solicita" requerido />
            <CampoTexto form={form} name="telefono" label="Teléfono" type="tel" requerido />
            <Controller
              control={form.control}
              name="tipo"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <EtiquetaCampo htmlFor="tipo" requerido>
                    Tipo de tarea
                  </EtiquetaCampo>
                  <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
                    <SelectTrigger
                      id="tipo"
                      className="w-full"
                      aria-invalid={fieldState.invalid}
                      aria-required
                    >
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
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoTexto form={form} name="ordenTrabajo" label="Orden de trabajo" />
              <CampoTexto form={form} name="pdRto" label="PD / RTO" />
            </div>
          </div>
          <Field data-invalid={!!errors.detalle}>
            <EtiquetaCampo htmlFor="detalle" requerido>
              Detalle del trabajo
            </EtiquetaCampo>
            <Textarea
              id="detalle"
              rows={3}
              aria-invalid={!!errors.detalle}
              aria-required
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
                    <label
                      key={c}
                      htmlFor={id}
                      className="flex items-center gap-2 text-sm pointer-coarse:min-h-11"
                    >
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
              className="pointer-coarse:h-11"
              disabled={subiendo}
              onClick={() => inputArchivo.current?.click()}
            >
              <FileUp />
              {subiendo ? "Subiendo…" : "Adjuntar archivo"}
            </Button>
          </div>
        </FieldSet>

        {editando && !supabase && (
          <Controller
            control={form.control}
            name="estado"
            render={({ field }) => (
              <Field className="max-w-xs">
                <FieldLabel htmlFor="estado">Estado</FieldLabel>
                <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
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

        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            type="submit"
            disabled={
              guardar.isPending ||
              subiendo ||
              equipoSinValvulas ||
              (editando && !isDirty && !adjuntosCambiados)
            }
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
      {dialogoMotivo}
    </form>
  )
}
