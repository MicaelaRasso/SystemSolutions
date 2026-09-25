"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { empresaSchema, type EmpresaInput } from "@/lib/domain/schemas"
import type { Empresa } from "@/lib/domain/types"
import { qk, useServiceMutation } from "@/lib/hooks/queries"
import { services } from "@/lib/services"

const VACIO: EmpresaInput = {
  razonSocial: "",
  cuit: "",
  contacto: "",
  telefono: "",
  email: "",
  direccion: "",
  avisoVencimiento: true,
  activo: true,
}

/** Alta y edición de empresa cliente (RF-06). Los campos finales dependen de P-02. */
export function EmpresaForm({ empresa }: { empresa?: Empresa }) {
  const router = useRouter()
  const editando = !!empresa

  const form = useForm<EmpresaInput>({
    resolver: zodResolver(empresaSchema),
    defaultValues: empresa
      ? {
          razonSocial: empresa.razonSocial,
          cuit: empresa.cuit,
          contacto: empresa.contacto,
          telefono: empresa.telefono,
          email: empresa.email,
          direccion: empresa.direccion,
          avisoVencimiento: empresa.avisoVencimiento,
          activo: empresa.activo,
        }
      : VACIO,
  })
  const { errors, isDirty } = form.formState

  const guardar = useServiceMutation(
    (data: EmpresaInput) =>
      empresa ? services.empresas.update(empresa.id, data) : services.empresas.create(data),
    {
      exito: editando ? "Cliente actualizado" : "Cliente creado",
      invalidar: [["empresas"], ...(empresa ? [qk.empresa(empresa.id)] : [])],
    },
  )

  async function onSubmit(data: EmpresaInput) {
    const res = await guardar.mutateAsync(data).catch(() => null)
    if (!res) return
    if (editando) form.reset(data)
    else router.push(`/admin/clientes/${res.id}/estructura`)
  }

  const texto = (
    name: Exclude<keyof EmpresaInput, "avisoVencimiento" | "activo">,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} aria-invalid={!!errors[name]} {...props} {...form.register(name)} />
      <FieldError errors={[errors[name]]} />
    </Field>
  )

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-3xl">
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">{texto("razonSocial", "Razón social")}</div>
          {texto("cuit", "CUIT", { placeholder: "30-12345678-9", inputMode: "numeric" })}
          {texto("contacto", "Contacto")}
          {texto("telefono", "Teléfono", { type: "tel" })}
          {texto("email", "Email", { type: "email" })}
          <div className="sm:col-span-2">{texto("direccion", "Dirección")}</div>
        </div>

        <FieldSeparator />

        <Controller
          control={form.control}
          name="avisoVencimiento"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="avisoVencimiento"
                checked={field.value}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor="avisoVencimiento">
                  Requiere envío de advertencia de vencimiento
                </FieldLabel>
                <FieldDescription>
                  Se envía un email 30 días antes de que venza cada certificado del cliente.
                </FieldDescription>
              </FieldContent>
            </Field>
          )}
        />

        {editando && (
          <Controller
            control={form.control}
            name="activo"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Switch id="activo" checked={field.value} onCheckedChange={field.onChange} />
                <FieldContent>
                  <FieldLabel htmlFor="activo">Cliente activo</FieldLabel>
                  <FieldDescription>
                    Si está inactivo, sus usuarios no pueden ingresar al portal. Su histórico se
                    conserva.
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
          />
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={guardar.isPending || (editando && !isDirty)}>
            {guardar.isPending ? "Guardando…" : editando ? "Guardar cambios" : "Crear cliente"}
          </Button>
          {editando ? (
            isDirty && (
              <Button type="button" variant="outline" onClick={() => form.reset()}>
                Descartar
              </Button>
            )
          ) : (
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancelar
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  )
}
