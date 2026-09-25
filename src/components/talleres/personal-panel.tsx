"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Pencil, Plus, Search, Users } from "lucide-react"
import { useState } from "react"
import { Controller, useForm } from "react-hook-form"

import { CampoTexto, FormDialog, PieFormulario } from "@/components/common/form-dialog"
import { EmptyState, ErrorState } from "@/components/common/states"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import { personaSchema, type PersonaInput } from "@/lib/domain/schemas"
import type { Persona } from "@/lib/domain/types"
import { qk, usePersonas, useServiceMutation } from "@/lib/hooks/queries"
import { services } from "@/lib/services"
import { cn } from "@/lib/utils"

const INVALIDAR = [qk.personas(), ["nominas"]]

/** Padrón de técnicos que se asignan a los talleres en cada jornada (RN-15). */
export function PersonalPanel() {
  const { data, isPending, isError, error, refetch } = usePersonas()
  const [busqueda, setBusqueda] = useState("")
  const activar = useServiceMutation(
    ({ id, activo }: { id: string; activo: boolean }) => services.personas.update(id, { activo }),
    { invalidar: INVALIDAR },
  )

  if (isError) return <ErrorState error={error} onRetry={() => refetch()} />

  const q = busqueda.trim().toLowerCase()
  const visibles = (data ?? []).filter(
    (p) => !q || `${p.nombre} ${p.apellido}`.toLowerCase().includes(q) || p.dni.includes(q),
  )

  const nueva = (
    <PersonaDialog
      trigger={
        <Button>
          <Plus />
          Nueva persona
        </Button>
      }
    />
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Técnicos que integran los talleres. Su nombre y DNI quedan en la nómina de cada
          certificado, según el cronograma de la jornada.
        </p>
        {nueva}
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o DNI"
          className="pl-8"
          aria-label="Buscar personal"
        />
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : data.length === 0 ? (
        <EmptyState icono={Users} titulo="Sin personal cargado" accion={nueva} />
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Apellido y nombre</TableHead>
                <TableHead>DNI</TableHead>
                <TableHead>Activo</TableHead>
                <TableHead className="text-right">Editar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((p) => (
                <TableRow key={p.id} className={cn(!p.activo && "opacity-60")}>
                  <TableCell className="font-medium">
                    {p.apellido}, {p.nombre}
                  </TableCell>
                  <TableCell className="tabular-nums">{p.dni}</TableCell>
                  <TableCell>
                    <Switch
                      checked={p.activo}
                      disabled={activar.isPending}
                      onCheckedChange={(activo) => activar.mutate({ id: p.id, activo })}
                      aria-label={`${p.activo ? "Desactivar" : "Activar"} a ${p.nombre} ${p.apellido}`}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <PersonaDialog
                      persona={p}
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar a ${p.nombre} ${p.apellido}`}
                        >
                          <Pencil />
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              ))}
              {visibles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Sin coincidencias
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function PersonaDialog({ persona, trigger }: { persona?: Persona; trigger: React.ReactNode }) {
  return (
    <FormDialog trigger={trigger} titulo={persona ? "Editar persona" : "Nueva persona"}>
      {(cerrar) => <PersonaForm persona={persona} cerrar={cerrar} />}
    </FormDialog>
  )
}

function PersonaForm({ persona, cerrar }: { persona?: Persona; cerrar: () => void }) {
  const form = useForm<PersonaInput>({
    resolver: zodResolver(personaSchema),
    defaultValues: {
      nombre: persona?.nombre ?? "",
      apellido: persona?.apellido ?? "",
      dni: persona?.dni ?? "",
      activo: persona?.activo ?? true,
    },
  })
  const guardar = useServiceMutation(
    (data: PersonaInput) =>
      persona ? services.personas.update(persona.id, data) : services.personas.create(data),
    { exito: persona ? "Persona actualizada" : "Persona agregada", invalidar: INVALIDAR },
  )

  return (
    <form noValidate onSubmit={form.handleSubmit((d) => guardar.mutate(d, { onSuccess: cerrar }))}>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto form={form} name="nombre" label="Nombre" autoFocus />
          <CampoTexto form={form} name="apellido" label="Apellido" />
        </div>
        <CampoTexto form={form} name="dni" label="DNI" inputMode="numeric" placeholder="35123456" />
        <Controller
          control={form.control}
          name="activo"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Switch id="persona-activa" checked={field.value} onCheckedChange={field.onChange} />
              <FieldContent>
                <FieldLabel htmlFor="persona-activa">Disponible para el cronograma</FieldLabel>
              </FieldContent>
            </Field>
          )}
        />
        <PieFormulario pendiente={guardar.isPending} cerrar={cerrar} crear={!persona} />
      </FieldGroup>
    </form>
  )
}
