"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Lock } from "lucide-react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { CampoTexto, FormDialog } from "@/components/common/form-dialog"
import { SelectNativo } from "@/components/common/select-nativo"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { horaFinPropuesta } from "@/lib/domain/rules"
import { cierreVisitaVencidaSchema, type CierreVisitaVencidaInput } from "@/lib/domain/schemas"
import {
  INVALIDAR_TAREAS,
  cerrarVisitaVencida,
  useServiceMutation,
  useTalleres,
  type OperationRead,
} from "@/lib/hooks/queries"

type Firma = { parte?: string; nombre_firmante?: string }

/** Firmas registradas de la visita (el detalle de la visita las trae junto a la fila). */
export function firmasDeLaVisita(operation: OperationRead) {
  const firmas = (operation.visit.visit as { signatures?: Firma[] }).signatures ?? []
  return {
    tecnico: firmas.find((firma) => firma.parte === "tecnico"),
    cliente: firmas.find((firma) => firma.parte === "cliente"),
  }
}

/** Órdenes que quedarán sin evaluar al cerrar: las que no tienen resultado o ya no se evaluaron. */
export function ordenesSinEvaluar(operation: OperationRead) {
  return operation.work_orders.filter(
    ({ work_order }) => work_order.estado === "pendiente" || work_order.estado === "no_evaluada",
  )
}

/**
 * E4: una visita en «Requiere finalización» se completa con las firmas que falten (Técnico desde
 * el panel del taller, Cliente desde el portal) o la cierra el Administrador con un motivo.
 */
export function CierreVisitaVencida({ operation }: { operation: OperationRead }) {
  const { tecnico, cliente } = firmasDeLaVisita(operation)
  const sinEvaluar = ordenesSinEvaluar(operation)

  return (
    <section
      className="max-w-4xl space-y-3 rounded-xl border border-orange-300/60 bg-orange-50/40 p-4 dark:bg-orange-950/20"
      aria-labelledby="cierre-vencida-title"
    >
      <div className="space-y-1">
        <h2
          id="cierre-vencida-title"
          className="font-semibold text-orange-950 dark:text-orange-200"
        >
          Visita en «Requiere finalización»
        </h2>
        <p className="text-sm text-muted-foreground">
          La visita venció a las 23:59 del día en que se inició. El Técnico puede cargar las firmas
          que falten desde el panel del taller y el Cliente puede firmar desde el portal; si con eso
          queda completa, se cierra sola. Si no, cerrala con un motivo.
        </p>
      </div>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        <li>
          Firma del Técnico:{" "}
          <span className="font-medium">
            {tecnico ? (tecnico.nombre_firmante ?? "registrada") : "pendiente"}
          </span>
        </li>
        <li>
          Firma del Cliente:{" "}
          <span className="font-medium">
            {cliente ? (cliente.nombre_firmante ?? "registrada") : "pendiente"}
          </span>
        </li>
      </ul>
      <p className="text-sm text-muted-foreground">
        Al cerrar, las válvulas sin evaluar
        {sinEvaluar.length ? ` (${sinEvaluar.length})` : ""} pasan a una visita de seguimiento de la
        misma solicitud y solo se emiten los certificados completos y firmados. Los borradores
        incompletos quedan como borrador para resolverlos después; no se descarta nada.
      </p>
      <FormDialog
        titulo="Cerrar visita vencida"
        descripcion="El motivo queda registrado en la auditoría de la visita."
        trigger={
          <Button variant="outline" className="max-sm:w-full">
            <Lock />
            Cerrar con motivo
          </Button>
        }
      >
        {(cerrar) => (
          <CierreVisitaVencidaForm
            operation={operation}
            conSeguimiento={sinEvaluar.length > 0}
            cerrar={cerrar}
          />
        )}
      </FormDialog>
    </section>
  )
}

function CierreVisitaVencidaForm({
  operation,
  conSeguimiento,
  cerrar,
}: {
  operation: OperationRead
  conSeguimiento: boolean
  cerrar: () => void
}) {
  const router = useRouter()
  const talleres = useTalleres()
  const visitId = String(operation.visit.visit.id ?? operation.operation.id)
  const form = useForm<CierreVisitaVencidaInput>({
    resolver: zodResolver(cierreVisitaVencidaSchema),
    defaultValues: {
      motivo: "",
      tallerId: conSeguimiento ? (operation.operation.taller_movil?.id ?? "") : "",
      fecha: "",
      hora: "09:00",
      horaFin: horaFinPropuesta("09:00"),
    },
  })
  const cierre = useServiceMutation(
    (datos: CierreVisitaVencidaInput) =>
      cerrarVisitaVencida(visitId, {
        motivo: datos.motivo,
        tallerId: datos.tallerId || undefined,
        fecha: datos.fecha || undefined,
        hora: datos.hora,
        horaFin: datos.horaFin,
      }),
    { invalidar: INVALIDAR_TAREAS },
  )
  const { errors } = form.formState

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((datos) =>
        cierre.mutate(datos, {
          onSuccess: (resultado) => {
            const borradores = resultado.incomplete_certificate_ids.length
            toast.success(
              borradores
                ? `Visita cerrada. ${borradores} borrador(es) incompleto(s) quedaron sin emitir.`
                : "Visita cerrada.",
            )
            cerrar()
            if (resultado.follow_up_visit_id)
              router.push(`/admin/tareas/${resultado.follow_up_visit_id}`)
          },
        }),
      )}
    >
      <FieldGroup>
        <Field data-invalid={!!errors.motivo}>
          <FieldLabel htmlFor="motivo">Motivo del cierre</FieldLabel>
          <Textarea
            id="motivo"
            aria-invalid={!!errors.motivo}
            maxLength={1000}
            autoFocus
            {...form.register("motivo")}
          />
          <FieldError errors={[errors.motivo]} />
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Visita de seguimiento</legend>
          <p className="text-xs text-muted-foreground">
            {conSeguimiento
              ? "Quedan válvulas sin evaluar: elegí el taller, el día y el horario estimado de la visita de seguimiento."
              : "Si alguna válvula quedó sin evaluar, elegí el taller, el día y el horario estimado de la visita de seguimiento."}
          </p>
          <Field data-invalid={!!errors.tallerId}>
            <FieldLabel htmlFor="tallerId">Taller Móvil</FieldLabel>
            <SelectNativo
              id="tallerId"
              aria-invalid={!!errors.tallerId}
              {...form.register("tallerId")}
            >
              <option value="">Sin visita de seguimiento</option>
              {(talleres.data ?? [])
                .filter((taller) => taller.activo)
                .map((taller) => (
                  <option key={taller.id} value={taller.id}>
                    {taller.nombre}
                  </option>
                ))}
            </SelectNativo>
            <FieldError errors={[errors.tallerId]} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <CampoTexto form={form} name="fecha" label="Fecha" type="date" />
            <Field data-invalid={!!errors.hora}>
              <FieldLabel htmlFor="hora">Hora de inicio</FieldLabel>
              <Input
                id="hora"
                type="time"
                aria-invalid={!!errors.hora}
                {...form.register("hora", {
                  // Al cambiar el inicio se vuelve a proponer el fin estimado (inicio + 1 h).
                  onChange: (event: { target: { value: string } }) =>
                    form.setValue("horaFin", horaFinPropuesta(event.target.value), {
                      shouldValidate: form.formState.isSubmitted,
                    }),
                })}
              />
              <FieldError errors={[errors.hora]} />
            </Field>
            <CampoTexto form={form} name="horaFin" label="Hora de fin estimada" type="time" />
          </div>
        </fieldset>
      </FieldGroup>
      <DialogFooter className="mt-4">
        <Button type="button" variant="outline" onClick={cerrar} disabled={cierre.isPending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={cierre.isPending}>
          {cierre.isPending ? "Cerrando…" : "Cerrar visita"}
        </Button>
      </DialogFooter>
    </form>
  )
}
