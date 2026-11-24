"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Info } from "lucide-react"
import { useRouter } from "next/navigation"
import { Controller, useForm } from "react-hook-form"

import { EtiquetaCampo } from "@/components/common/etiqueta-obligatoria"
import { PieFormulario } from "@/components/common/form-dialog"
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

/**
 * Alta y edición de empresa cliente (RF-06). Los campos finales dependen de P-02.
 *
 * Con `dialogo` el formulario vive dentro de un diálogo (solo alta): no navega, avisa con
 * `onCreated(empresa)` y usa el pie del diálogo.
 */
export function EmpresaForm({
  empresa,
  dialogo,
}: {
  empresa?: Empresa
  dialogo?: { cerrar: () => void; onCreated: (empresa: Empresa) => void }
}) {
  const router = useRouter()
  const editando = !!empresa
  // En un diálogo conviven con el formulario que lo abrió: los ids no pueden repetirse.
  const idDe = (name: string) => (dialogo ? `empresa-nueva-${name}` : name)

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
    else if (dialogo) {
      dialogo.cerrar()
      dialogo.onCreated(res)
    } else router.push(`/admin/clientes/${res.id}/estructura`)
  }

  const texto = (
    name: Exclude<keyof EmpresaInput, "avisoVencimiento" | "activo">,
    label: string,
    {
      requerido = false,
      ...props
    }: React.ComponentProps<typeof Input> & { requerido?: boolean } = {},
  ) => (
    <Field data-invalid={!!errors[name]}>
      <EtiquetaCampo htmlFor={idDe(name)} requerido={requerido}>
        {label}
      </EtiquetaCampo>
      <Input
        id={idDe(name)}
        aria-invalid={!!errors[name]}
        aria-required={requerido || undefined}
        {...props}
        {...form.register(name)}
      />
      <FieldError errors={[errors[name]]} />
    </Field>
  )

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      className={dialogo ? undefined : "max-w-3xl"}
    >
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            {texto("razonSocial", "Razón social", { requerido: true })}
          </div>
          {texto("cuit", "CUIT", {
            requerido: true,
            placeholder: "30-12345678-9",
            inputMode: "numeric",
          })}
          {texto("contacto", "Contacto", { requerido: true })}
          {texto("telefono", "Teléfono", { requerido: true, type: "tel" })}
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
                id={idDe("avisoVencimiento")}
                checked={field.value}
                onCheckedChange={(v) => field.onChange(v === true)}
              />
              <FieldContent>
                <FieldLabel htmlFor={idDe("avisoVencimiento")}>
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

        {dialogo ? (
          <>
            <div className="flex gap-2 rounded-lg bg-field/60 p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>Se enviará una invitación por correo a la cuenta del cliente.</p>
            </div>
            <PieFormulario pendiente={guardar.isPending} cerrar={dialogo.cerrar} crear />
          </>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
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
        )}
      </FieldGroup>
    </form>
  )
}
