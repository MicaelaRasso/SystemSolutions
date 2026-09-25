"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { AlertTriangle, Pencil, Plus, Trash2, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { Controller, useForm } from "react-hook-form"

import { ConfirmDialog } from "@/components/common/confirm-dialog"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import { usuarioClienteSchema, type UsuarioClienteInput } from "@/lib/domain/schemas"
import type { ArbolYacimiento, ID, Usuario } from "@/lib/domain/types"
import { fmtFecha, nombreCompleto } from "@/lib/format"
import { qk, useAccesos, useArbol, useServiceMutation, useUsuarios } from "@/lib/hooks/queries"
import { services } from "@/lib/services"
import { DEMO_PASSWORD } from "@/lib/services/mock/seed"

import {
  AccesosSelector,
  accesosDesdeClaves,
  claveAcceso,
  type ClaveAcceso,
} from "./accesos-selector"

/** Usuarios de la empresa cliente y sus accesos a la estructura (RF-03, RN-09). */
export function UsuariosCliente({ empresaId }: { empresaId: ID }) {
  const usuarios = useUsuarios({ rol: "cliente", empresaId })
  const arbol = useArbol(empresaId)

  const nombres = useMemo(() => {
    const m = new Map<string, string>()
    for (const y of arbol.data ?? []) {
      m.set(`yacimiento:${y.id}`, y.nombre)
      for (const p of y.plantas) {
        m.set(`planta:${p.id}`, p.nombre)
        for (const e of p.equipos) m.set(`equipo:${e.id}`, `${p.nombre} · ${e.nombre}`)
      }
    }
    return m
  }, [arbol.data])

  const eliminar = useServiceMutation((id: ID) => services.usuarios.delete(id), {
    exito: "Usuario eliminado",
    invalidar: [["usuarios"], ["empresas"]],
  })
  const activar = useServiceMutation(
    ({ id, activo }: { id: ID; activo: boolean }) => services.usuarios.update(id, { activo }),
    { invalidar: [["usuarios"]] },
  )

  if (usuarios.isError || arbol.isError) {
    return (
      <ErrorState
        error={usuarios.error ?? arbol.error}
        onRetry={() => {
          usuarios.refetch()
          arbol.refetch()
        }}
      />
    )
  }

  const nuevo = arbol.data && (
    <UsuarioDialog
      empresaId={empresaId}
      arbol={arbol.data}
      trigger={
        <Button>
          <Plus />
          Nuevo usuario
        </Button>
      }
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cada usuario ve en el portal solo los yacimientos, plantas y equipos que tiene asignados:
          sus turnos y sus certificados vigentes.
        </p>
        {nuevo}
      </div>

      {usuarios.isPending || arbol.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : usuarios.data.length === 0 ? (
        <EmptyState
          icono={Users}
          titulo="Sin usuarios"
          descripcion="Creá un usuario para que el cliente pueda consultar sus turnos y certificados."
          accion={nuevo}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Accesos</TableHead>
                <TableHead className="hidden md:table-cell">Alta</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{nombreCompleto(u)}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </TableCell>
                  <TableCell>
                    <ResumenAccesos usuarioId={u.id} nombres={nombres} />
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {fmtFecha(u.creadoEn)}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={u.activo}
                      disabled={activar.isPending}
                      onCheckedChange={(activo) => activar.mutate({ id: u.id, activo })}
                      aria-label={`${u.activo ? "Desactivar" : "Activar"} a ${nombreCompleto(u)}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <UsuarioDialog
                        empresaId={empresaId}
                        arbol={arbol.data}
                        usuario={u}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar a ${nombreCompleto(u)}`}
                          >
                            <Pencil />
                          </Button>
                        }
                      />
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Eliminar a ${nombreCompleto(u)}`}
                          >
                            <Trash2 />
                          </Button>
                        }
                        titulo={`¿Eliminar a ${nombreCompleto(u)}?`}
                        descripcion="Pierde el acceso al portal. Si solo querés suspenderlo, desactivalo."
                        onConfirm={() => eliminar.mutateAsync(u.id)}
                      />
                    </div>
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

function ResumenAccesos({ usuarioId, nombres }: { usuarioId: ID; nombres: Map<string, string> }) {
  const { data, isPending } = useAccesos(usuarioId)
  if (isPending) return <Skeleton className="h-5 w-32" />
  if (!data?.length) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-700">
        <AlertTriangle className="size-3.5" />
        Sin accesos
      </span>
    )
  }
  const etiquetas = data.map((a) => nombres.get(claveAcceso(a)) ?? "—")
  const visibles = etiquetas.slice(0, 2)
  return (
    <div className="flex flex-wrap gap-1">
      {visibles.map((e, i) => (
        <Badge key={i} variant="secondary" className="font-normal">
          {e}
        </Badge>
      ))}
      {etiquetas.length > visibles.length && (
        <Badge variant="outline" title={etiquetas.slice(2).join(", ")}>
          +{etiquetas.length - visibles.length}
        </Badge>
      )}
    </div>
  )
}

function UsuarioDialog({
  empresaId,
  arbol,
  usuario,
  trigger,
}: {
  empresaId: ID
  arbol: ArbolYacimiento[]
  usuario?: Usuario
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{usuario ? "Editar usuario" : "Nuevo usuario del cliente"}</DialogTitle>
          <DialogDescription>
            {usuario
              ? usuario.email
              : `Recibirá un email para definir su contraseña (en modo demo: ${DEMO_PASSWORD}).`}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <UsuarioForm
            empresaId={empresaId}
            arbol={arbol}
            usuario={usuario}
            cerrar={() => setOpen(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function UsuarioForm({
  empresaId,
  arbol,
  usuario,
  cerrar,
}: {
  empresaId: ID
  arbol: ArbolYacimiento[]
  usuario?: Usuario
  cerrar: () => void
}) {
  const accesosActuales = useAccesos(usuario?.id)
  const form = useForm<UsuarioClienteInput>({
    resolver: zodResolver(usuarioClienteSchema),
    defaultValues: {
      nombre: usuario?.nombre ?? "",
      apellido: usuario?.apellido ?? "",
      email: usuario?.email ?? "",
      activo: usuario?.activo ?? true,
    },
  })
  const { errors } = form.formState

  // Hasta que el usuario toque la selección, se muestran los accesos guardados.
  const [editados, setEditados] = useState<Set<ClaveAcceso> | null>(null)
  const guardados = useMemo(
    () => new Set((accesosActuales.data ?? []).map(claveAcceso)),
    [accesosActuales.data],
  )
  const accesos = editados ?? guardados

  const guardar = useServiceMutation(
    async (data: UsuarioClienteInput) => {
      const u = usuario
        ? await services.usuarios.update(usuario.id, data)
        : await services.usuarios.create({ ...data, rol: "cliente", empresaId })
      await services.usuarios.setAccesos(u.id, accesosDesdeClaves(accesos))
      return u
    },
    {
      exito: usuario ? "Usuario actualizado" : "Usuario creado",
      invalidar: [["usuarios"], ["accesos"], ["empresas"], qk.empresa(empresaId)],
    },
  )

  const texto = (name: "nombre" | "apellido" | "email", label: string, type = "text") => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={`u-${name}`}>{label}</FieldLabel>
      <Input id={`u-${name}`} type={type} aria-invalid={!!errors[name]} {...form.register(name)} />
      <FieldError errors={[errors[name]]} />
    </Field>
  )

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((data) => guardar.mutate(data, { onSuccess: cerrar }))}
      className="max-h-[70vh] overflow-y-auto pr-1"
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          {texto("nombre", "Nombre")}
          {texto("apellido", "Apellido")}
          <div className="sm:col-span-2">{texto("email", "Email", "email")}</div>
        </div>

        <FieldSet>
          <FieldLegend variant="label">Accesos</FieldLegend>
          <FieldDescription>
            Marcá un yacimiento para darle acceso completo, o elegí plantas o equipos puntuales.
          </FieldDescription>
          {usuario && accesosActuales.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <AccesosSelector arbol={arbol} value={accesos} onChange={setEditados} />
          )}
          {accesos.size === 0 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="size-3.5" />
              Sin accesos el usuario puede ingresar, pero no va a ver ninguna información.
            </p>
          )}
        </FieldSet>

        <Controller
          control={form.control}
          name="activo"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="u-activo" checked={field.value} onCheckedChange={field.onChange} />
              <FieldContent>
                <FieldLabel htmlFor="u-activo">Usuario activo</FieldLabel>
              </FieldContent>
            </Field>
          )}
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={cerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={guardar.isPending}>
            {guardar.isPending ? "Guardando…" : usuario ? "Guardar" : "Crear usuario"}
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  )
}
