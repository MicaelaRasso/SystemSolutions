"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { addYears, format, parseISO } from "date-fns"
import { AlertTriangle, CalendarPlus, Gauge, Pencil, Plus } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { CampoTexto, FormDialog, PieFormulario } from "@/components/common/form-dialog"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { estadoPatron } from "@/lib/domain/rules"
import { patronSchema, type PatronInput } from "@/lib/domain/schemas"
import type { Patron } from "@/lib/domain/types"
import { fmtFecha } from "@/lib/format"
import { qk, usePatrones, useServiceMutation } from "@/lib/hooks/queries"
import { services } from "@/lib/services"
import { cn } from "@/lib/utils"

function EstadoPatronBadge({ vencimiento }: { vencimiento: string }) {
  const { estado, diasRestantes } = estadoPatron(vencimiento)
  if (estado === "vencido") {
    return <Badge className="border-transparent bg-red-100 text-red-800">Vencido</Badge>
  }
  if (estado === "por_vencer") {
    return (
      <Badge className="border-transparent bg-amber-100 text-amber-900">
        Vence en {diasRestantes} {diasRestantes === 1 ? "día" : "días"}
      </Badge>
    )
  }
  return <Badge className="border-transparent bg-emerald-100 text-emerald-800">Vigente</Badge>
}

/** Patrones de calibración (desplegable 5). El vencimiento se renueva cada año. */
export function PatronesEditor() {
  const { data, isPending, isError, error, refetch } = usePatrones()
  const activar = useServiceMutation(
    ({ id, activo }: { id: string; activo: boolean }) => services.patrones.update(id, { activo }),
    { invalidar: [qk.patrones()] },
  )

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />

  const alertas = (data ?? []).filter(
    (p) => p.activo && estadoPatron(p.vencimiento).estado !== "vigente",
  )

  const nuevo = (
    <PatronDialog
      trigger={
        <Button>
          <Plus />
          Nuevo patrón
        </Button>
      }
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Instrumentos de referencia que el técnico elige en los ensayos. Su vencimiento se imprime
          en el certificado y se actualiza cada año al recalibrarlos.
        </p>
        {nuevo}
      </div>

      {alertas.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>
            {alertas.length === 1
              ? "Hay 1 patrón activo"
              : `Hay ${alertas.length} patrones activos`}{" "}
            vencido o por vencer: {alertas.map((p) => `${p.nombre} ${p.nroSerie}`).join(", ")}.
            Renová su vencimiento o desactivalos para que no se usen en campo.
          </p>
        </div>
      )}

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : data.length === 0 ? (
        <EmptyState icono={Gauge} titulo="Sin patrones cargados" accion={nuevo} />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Patrón</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Editar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow key={p.id} className={cn(!p.activo && "opacity-60")}>
                  <TableCell>
                    <div className="font-medium">{p.nombre}</div>
                    <div className="font-mono text-xs text-muted-foreground">N° {p.nroSerie}</div>
                  </TableCell>
                  <TableCell>{fmtFecha(p.vencimiento)}</TableCell>
                  <TableCell>
                    {p.activo ? (
                      <EstadoPatronBadge vencimiento={p.vencimiento} />
                    ) : (
                      <Badge variant="secondary">Inactivo</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={p.activo}
                      disabled={activar.isPending}
                      onCheckedChange={(activo) => activar.mutate({ id: p.id, activo })}
                      aria-label={`${p.activo ? "Desactivar" : "Activar"} ${p.nombre} ${p.nroSerie}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <PatronDialog
                      patron={p}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${p.nombre} ${p.nroSerie}`}
                        >
                          <Pencil />
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function PatronDialog({ patron, trigger }: { patron?: Patron; trigger: React.ReactNode }) {
  return (
    <FormDialog
      trigger={trigger}
      titulo={patron ? `Editar ${patron.nombre}` : "Nuevo patrón"}
      descripcion="Se muestra como “NOMBRE N°SERIE” en el desplegable de ensayos."
    >
      {(cerrar) => <PatronForm patron={patron} cerrar={cerrar} />}
    </FormDialog>
  )
}

function PatronForm({ patron, cerrar }: { patron?: Patron; cerrar: () => void }) {
  const form = useForm<PatronInput>({
    resolver: zodResolver(patronSchema),
    defaultValues: {
      nombre: patron?.nombre ?? "",
      nroSerie: patron?.nroSerie ?? "",
      vencimiento: patron?.vencimiento ?? format(addYears(new Date(), 1), "yyyy-MM-dd"),
      activo: patron?.activo ?? true,
    },
  })
  const guardar = useServiceMutation(
    (data: PatronInput) => {
      const payload = { ...data, nombre: data.nombre.toUpperCase() }
      return patron
        ? services.patrones.update(patron.id, payload)
        : services.patrones.create(payload)
    },
    { exito: patron ? "Patrón actualizado" : "Patrón creado", invalidar: [qk.patrones()] },
  )

  function renovar() {
    const actual = form.getValues("vencimiento")
    const base = actual ? parseISO(actual) : new Date()
    form.setValue("vencimiento", format(addYears(base, 1), "yyyy-MM-dd"), {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  return (
    <form noValidate onSubmit={form.handleSubmit((d) => guardar.mutate(d, { onSuccess: cerrar }))}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            form={form}
            name="nombre"
            label="Nombre"
            placeholder="KELLER LEO 1"
            autoFocus
          />
          <CampoTexto form={form} name="nroSerie" label="N° de serie" placeholder="122330" />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <CampoTexto form={form} name="vencimiento" label="Vencimiento" type="date" />
          </div>
          <Button type="button" variant="outline" onClick={renovar}>
            <CalendarPlus />
            Sumar un año
          </Button>
        </div>
        <Controller
          control={form.control}
          name="activo"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="patron-activo" checked={field.value} onCheckedChange={field.onChange} />
              <FieldContent>
                <FieldLabel htmlFor="patron-activo">Disponible para usar en campo</FieldLabel>
              </FieldContent>
            </Field>
          )}
        />
        <PieFormulario pendiente={guardar.isPending} cerrar={cerrar} crear={!patron} />
      </FieldGroup>
    </form>
  )
}
