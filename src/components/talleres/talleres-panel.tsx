"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Check, Pencil, Plus, Tablet, Truck } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { EstadoActivoBadge } from "@/components/certificados/badges"
import { CampoTexto, FormDialog, PieFormulario } from "@/components/common/form-dialog"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { COLORES_TALLER } from "@/lib/domain/catalogos"
import { tallerSchema, type TallerInput } from "@/lib/domain/schemas"
import { qk, useServiceMutation, useTalleres } from "@/lib/hooks/queries"
import { services, type TallerConCuenta } from "@/lib/services"
import { DEMO_PASSWORD } from "@/lib/services/mock/seed"
import { cn } from "@/lib/utils"

/** Invalida talleres y todo lo que muestra su nombre o color. */
const INVALIDAR = [qk.talleres(), ["tareas"], ["tarea"], ["usuarios"]]

/** Cuentas de taller móvil (RF-04): una por equipo de trabajo / tablet, activas en simultáneo. */
export function TalleresPanel() {
  const { data, isPending, isError, error, refetch } = useTalleres()
  const activar = useServiceMutation(
    ({ id, activo }: { id: string; activo: boolean }) => services.talleres.update(id, { activo }),
    { invalidar: INVALIDAR },
  )

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />

  const nuevo = (
    <TallerDialog
      usados={data?.map((t) => t.color) ?? []}
      trigger={
        <Button>
          <Plus />
          Nuevo taller
        </Button>
      }
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada taller móvil tiene una cuenta compartida por su equipo, con la que se ingresa desde
          la tablet de campo. Quién integra el taller cada día se define en el Cronograma.
        </p>
        {nuevo}
      </div>

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState icono={Truck} titulo="Todavía no hay talleres móviles" accion={nuevo} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((t) => (
            <Card key={t.id} className={cn(!t.activo && "opacity-70")}>
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-9 items-center justify-center rounded-lg text-white"
                    style={{ backgroundColor: t.color }}
                    aria-hidden
                  >
                    <Truck className="size-5" />
                  </span>
                  <div>
                    <CardTitle className="text-base">{t.nombre}</CardTitle>
                    <EstadoActivoBadge activo={t.activo} />
                  </div>
                </div>
                <TallerDialog
                  taller={t}
                  usados={data.filter((x) => x.id !== t.id).map((x) => x.color)}
                  trigger={
                    <Button variant="ghost" size="icon" aria-label={`Editar ${t.nombre}`}>
                      <Pencil />
                    </Button>
                  }
                />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Tablet className="size-4 text-muted-foreground" />
                  <span className="truncate">{t.email || "Sin cuenta"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id={`activo-${t.id}`}
                    checked={t.activo}
                    disabled={activar.isPending}
                    onCheckedChange={(activo) => activar.mutate({ id: t.id, activo })}
                  />
                  <label htmlFor={`activo-${t.id}`} className="text-sm">
                    {t.activo ? "Puede ingresar desde la tablet" : "Cuenta deshabilitada"}
                  </label>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function TallerDialog({
  taller,
  usados,
  trigger,
}: {
  taller?: TallerConCuenta
  usados: string[]
  trigger: React.ReactNode
}) {
  return (
    <FormDialog
      trigger={trigger}
      titulo={taller ? `Editar ${taller.nombre}` : "Nuevo taller móvil"}
      descripcion={
        taller
          ? undefined
          : `Se crea la cuenta de acceso para la tablet (en modo demo, contraseña ${DEMO_PASSWORD}).`
      }
    >
      {(cerrar) => <TallerForm taller={taller} usados={usados} cerrar={cerrar} />}
    </FormDialog>
  )
}

function TallerForm({
  taller,
  usados,
  cerrar,
}: {
  taller?: TallerConCuenta
  usados: string[]
  cerrar: () => void
}) {
  const libre = COLORES_TALLER.find((c) => !usados.includes(c)) ?? COLORES_TALLER[0]
  const form = useForm<TallerInput>({
    resolver: zodResolver(tallerSchema),
    defaultValues: {
      nombre: taller?.nombre ?? "",
      email: taller?.email ?? "",
      color: taller?.color ?? libre,
      activo: taller?.activo ?? true,
    },
  })
  const guardar = useServiceMutation(
    (data: TallerInput) =>
      taller ? services.talleres.update(taller.id, data) : services.talleres.create(data),
    { exito: taller ? "Taller actualizado" : "Taller creado", invalidar: INVALIDAR },
  )

  return (
    <form noValidate onSubmit={form.handleSubmit((d) => guardar.mutate(d, { onSuccess: cerrar }))}>
      <FieldGroup>
        <CampoTexto
          form={form}
          name="nombre"
          label="Nombre"
          placeholder="Taller Móvil 4"
          autoFocus
        />
        <CampoTexto
          form={form}
          name="email"
          label="Email de la cuenta"
          type="email"
          placeholder="taller4@systemsrl.com.ar"
        />
        <Controller
          control={form.control}
          name="color"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel>Color en agenda y cronograma</FieldLabel>
              <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
                {COLORES_TALLER.map((c) => {
                  const elegido = field.value === c
                  const ocupado = usados.includes(c)
                  return (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={elegido}
                      aria-label={`Color ${c}${ocupado ? " (usado por otro taller)" : ""}`}
                      onClick={() => field.onChange(c)}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition",
                        elegido && "ring-2 ring-foreground",
                        ocupado && !elegido && "opacity-40",
                      )}
                      style={{ backgroundColor: c }}
                    >
                      {elegido && <Check className="size-4 text-white" />}
                    </button>
                  )
                })}
              </div>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {taller && (
          <Controller
            control={form.control}
            name="activo"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Switch id="taller-activo" checked={field.value} onCheckedChange={field.onChange} />
                <FieldContent>
                  <FieldLabel htmlFor="taller-activo">Taller activo</FieldLabel>
                  <FieldDescription>
                    Si se desactiva, su cuenta no puede ingresar y deja de ofrecerse al asignar
                    tareas.
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
          />
        )}
        <PieFormulario pendiente={guardar.isPending} cerrar={cerrar} crear={!taller} />
      </FieldGroup>
    </form>
  )
}
