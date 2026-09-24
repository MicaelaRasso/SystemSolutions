"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Info } from "lucide-react"
import { Controller, useForm } from "react-hook-form"

import { Combobox } from "@/components/common/combobox"
import { CampoTexto, FormDialog, PieFormulario as Pie } from "@/components/common/form-dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PROVINCIAS } from "@/lib/domain/catalogos"
import {
  equipoSchema,
  plantaSchema,
  valvulaSchema,
  yacimientoSchema,
  type EquipoInput,
  type PlantaInput,
  type ValvulaInput,
  type YacimientoInput,
} from "@/lib/domain/schemas"
import type { Equipo, ID, Planta, Valvula, Yacimiento } from "@/lib/domain/types"
import { qk, useCatalogo, useServiceMutation } from "@/lib/hooks/queries"
import { services } from "@/lib/services"

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

function invalidarEstructura(empresaId: ID) {
  return [qk.arbol(empresaId), ["empresas"]]
}

// ---------------------------------------------------------------------------
// Yacimiento
// ---------------------------------------------------------------------------

export function YacimientoDialog({
  empresaId,
  yacimiento,
  trigger,
  onSaved,
}: {
  empresaId: ID
  yacimiento?: Yacimiento
  trigger: React.ReactNode
  onSaved?: (id: ID) => void
}) {
  return (
    <FormDialog
      trigger={trigger}
      titulo={yacimiento ? "Editar yacimiento" : "Nuevo yacimiento"}
      descripcion="Área geográfica donde opera el cliente. Agrupa una o más plantas."
    >
      {(cerrar) => (
        <YacimientoForm
          empresaId={empresaId}
          yacimiento={yacimiento}
          cerrar={cerrar}
          onSaved={onSaved}
        />
      )}
    </FormDialog>
  )
}

function YacimientoForm({
  empresaId,
  yacimiento,
  cerrar,
  onSaved,
}: {
  empresaId: ID
  yacimiento?: Yacimiento
  cerrar: () => void
  onSaved?: (id: ID) => void
}) {
  const form = useForm<YacimientoInput>({
    resolver: zodResolver(yacimientoSchema),
    defaultValues: {
      nombre: yacimiento?.nombre ?? "",
      provincia: yacimiento?.provincia ?? "Neuquén",
      operadora: yacimiento?.operadora ?? "",
    },
  })
  const guardar = useServiceMutation(
    (data: YacimientoInput) =>
      yacimiento
        ? services.estructura.updateYacimiento(yacimiento.id, data)
        : services.estructura.createYacimiento({ ...data, empresaId }),
    {
      exito: yacimiento ? "Yacimiento actualizado" : "Yacimiento creado",
      invalidar: invalidarEstructura(empresaId),
    },
  )

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((data) =>
        guardar.mutate(data, {
          onSuccess: (y) => {
            cerrar()
            onSaved?.(y.id)
          },
        }),
      )}
    >
      <FieldGroup>
        <CampoTexto form={form} name="nombre" label="Nombre" autoFocus />
        <Controller
          control={form.control}
          name="provincia"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="provincia">Provincia</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="provincia" className="w-full" aria-invalid={fieldState.invalid}>
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCIAS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <CampoTexto
          form={form}
          name="operadora"
          label="Operadora"
          placeholder="Empresa operadora del yacimiento"
        />
        <Pie pendiente={guardar.isPending} cerrar={cerrar} crear={!yacimiento} />
      </FieldGroup>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Planta / Locación
// ---------------------------------------------------------------------------

export function PlantaDialog({
  empresaId,
  yacimientoId,
  planta,
  trigger,
  onSaved,
}: {
  empresaId: ID
  yacimientoId: ID
  planta?: Planta
  trigger: React.ReactNode
  onSaved?: (id: ID) => void
}) {
  return (
    <FormDialog
      trigger={trigger}
      titulo={planta ? "Editar planta / locación" : "Nueva planta / locación"}
      descripcion="Instalación dentro del yacimiento, por ejemplo una estación compresora."
    >
      {(cerrar) => (
        <PlantaForm
          empresaId={empresaId}
          yacimientoId={yacimientoId}
          planta={planta}
          cerrar={cerrar}
          onSaved={onSaved}
        />
      )}
    </FormDialog>
  )
}

function PlantaForm({
  empresaId,
  yacimientoId,
  planta,
  cerrar,
  onSaved,
}: {
  empresaId: ID
  yacimientoId: ID
  planta?: Planta
  cerrar: () => void
  onSaved?: (id: ID) => void
}) {
  const form = useForm<PlantaInput>({
    resolver: zodResolver(plantaSchema),
    defaultValues: { nombre: planta?.nombre ?? "" },
  })
  const guardar = useServiceMutation(
    (data: PlantaInput) =>
      planta
        ? services.estructura.updatePlanta(planta.id, data)
        : services.estructura.createPlanta({ ...data, yacimientoId }),
    {
      exito: planta ? "Planta actualizada" : "Planta creada",
      invalidar: invalidarEstructura(empresaId),
    },
  )

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((data) =>
        guardar.mutate(data, {
          onSuccess: (p) => {
            cerrar()
            onSaved?.(p.id)
          },
        }),
      )}
    >
      <FieldGroup>
        <CampoTexto
          form={form}
          name="nombre"
          label="Nombre"
          placeholder="Ej. Planta Compresora N°8"
          autoFocus
        />
        <Pie pendiente={guardar.isPending} cerrar={cerrar} crear={!planta} />
      </FieldGroup>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Equipo / Unidad
// ---------------------------------------------------------------------------

export function EquipoDialog({
  empresaId,
  plantaId,
  equipo,
  trigger,
  onSaved,
}: {
  empresaId: ID
  plantaId: ID
  equipo?: Equipo
  trigger: React.ReactNode
  onSaved?: (id: ID) => void
}) {
  return (
    <FormDialog
      trigger={trigger}
      titulo={equipo ? "Editar equipo / unidad" : "Nuevo equipo / unidad"}
      descripcion="Máquina o conjunto de máquinas que contiene válvulas de seguridad."
    >
      {(cerrar) => (
        <EquipoForm
          empresaId={empresaId}
          plantaId={plantaId}
          equipo={equipo}
          cerrar={cerrar}
          onSaved={onSaved}
        />
      )}
    </FormDialog>
  )
}

function EquipoForm({
  empresaId,
  plantaId,
  equipo,
  cerrar,
  onSaved,
}: {
  empresaId: ID
  plantaId: ID
  equipo?: Equipo
  cerrar: () => void
  onSaved?: (id: ID) => void
}) {
  const form = useForm<EquipoInput>({
    resolver: zodResolver(equipoSchema),
    defaultValues: { nombre: equipo?.nombre ?? "", descripcion: equipo?.descripcion ?? "" },
  })
  const guardar = useServiceMutation(
    (data: EquipoInput) => {
      const payload = { ...data, descripcion: data.descripcion || undefined }
      return equipo
        ? services.estructura.updateEquipo(equipo.id, payload)
        : services.estructura.createEquipo({ ...payload, plantaId })
    },
    {
      exito: equipo ? "Equipo actualizado" : "Equipo creado",
      invalidar: invalidarEstructura(empresaId),
    },
  )

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((data) =>
        guardar.mutate(data, {
          onSuccess: (e) => {
            cerrar()
            onSaved?.(e.id)
          },
        }),
      )}
    >
      <FieldGroup>
        <CampoTexto
          form={form}
          name="nombre"
          label="Identificación"
          placeholder="Ej. K52100"
          autoFocus
        />
        <CampoTexto
          form={form}
          name="descripcion"
          label="Descripción (opcional)"
          placeholder="Ej. Unidad compresora"
        />
        <Pie pendiente={guardar.isPending} cerrar={cerrar} crear={!equipo} />
      </FieldGroup>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Válvula
// ---------------------------------------------------------------------------

const aNumero = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")))
const aTexto = (s: string) => (s.trim() === "" ? undefined : s.trim())

function valvulaDesdeInput(data: ValvulaInput): Omit<Valvula, "id" | "equipoId"> {
  return {
    tag: data.tag.trim().toUpperCase(),
    precinto: aTexto(data.precinto),
    servicio: aTexto(data.servicio),
    marca: aTexto(data.marca),
    nroSerie: aTexto(data.nroSerie),
    modelo: aTexto(data.modelo),
    tipo: data.tipo || undefined,
    pv: aTexto(data.pv),
    diamEntrada: aTexto(data.diamEntrada),
    diamSalida: aTexto(data.diamSalida),
    rosca: aTexto(data.rosca),
    presionOperacion: aNumero(data.presionOperacion),
    temperaturaOperacion: aNumero(data.temperaturaOperacion),
    notas: aTexto(data.notas),
  }
}

function inputDesdeValvula(v?: Valvula): ValvulaInput {
  return {
    tag: v?.tag ?? "",
    precinto: v?.precinto ?? "",
    servicio: v?.servicio ?? "",
    marca: v?.marca ?? "",
    nroSerie: v?.nroSerie ?? "",
    modelo: v?.modelo ?? "",
    tipo: v?.tipo ?? "",
    pv: v?.pv ?? "",
    diamEntrada: v?.diamEntrada ?? "",
    diamSalida: v?.diamSalida ?? "",
    rosca: v?.rosca ?? "",
    presionOperacion: v?.presionOperacion?.toString() ?? "",
    temperaturaOperacion: v?.temperaturaOperacion?.toString() ?? "",
    notas: v?.notas ?? "",
  }
}

export function ValvulaDialog({
  empresaId,
  equipoId,
  valvula,
  trigger,
  onSaved,
}: {
  empresaId: ID
  equipoId: ID
  valvula?: Valvula
  trigger: React.ReactNode
  onSaved?: (id: ID) => void
}) {
  return (
    <FormDialog
      trigger={trigger}
      titulo={valvula ? `Editar ${valvula.tag}` : "Nueva válvula de seguridad"}
      ancho="sm:max-w-3xl"
    >
      {(cerrar) => (
        <ValvulaForm
          empresaId={empresaId}
          equipoId={equipoId}
          valvula={valvula}
          cerrar={cerrar}
          onSaved={onSaved}
        />
      )}
    </FormDialog>
  )
}

function ValvulaForm({
  empresaId,
  equipoId,
  valvula,
  cerrar,
  onSaved,
}: {
  empresaId: ID
  equipoId: ID
  valvula?: Valvula
  cerrar: () => void
  onSaved?: (id: ID) => void
}) {
  const form = useForm<ValvulaInput>({
    resolver: zodResolver(valvulaSchema),
    defaultValues: inputDesdeValvula(valvula),
  })
  const diamEntrada = useCatalogo("diamEntrada")
  const diamSalida = useCatalogo("diamSalida")
  const rosca = useCatalogo("rosca")
  const tipo = useCatalogo("tipo")

  const guardar = useServiceMutation(
    (data: ValvulaInput) => {
      const payload = valvulaDesdeInput(data)
      return valvula
        ? services.estructura.updateValvula(valvula.id, payload)
        : services.estructura.createValvula({ ...payload, equipoId })
    },
    {
      exito: valvula ? "Válvula actualizada" : "Válvula creada",
      invalidar: [...invalidarEstructura(empresaId), ...(valvula ? [qk.valvula(valvula.id)] : [])],
    },
  )

  const combo = (
    name: "diamEntrada" | "diamSalida",
    label: string,
    opciones: string[] | undefined,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Combobox
            id={name}
            value={field.value}
            onChange={field.onChange}
            opciones={opciones ?? []}
            placeholder="Seleccionar medida"
            buscar="Buscar medida…"
          />
        </Field>
      )}
    />
  )

  const select = (name: "rosca" | "tipo", label: string, opciones: string[] | undefined) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Select value={field.value} onValueChange={(v) => v && field.onChange(v)}>
            <SelectTrigger id={name} className="w-full">
              <SelectValue placeholder="Seleccionar" />
            </SelectTrigger>
            <SelectContent>
              {(opciones ?? []).map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    />
  )

  const valores = (q: typeof rosca) => q.data?.map((o) => o.valor)

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((data) =>
        guardar.mutate(data, {
          onSuccess: (v) => {
            cerrar()
            onSaved?.(v.id)
          },
        }),
      )}
      className="max-h-[70vh] overflow-y-auto pr-1"
    >
      <FieldGroup>
        <div className="flex gap-2 rounded-lg bg-field/60 p-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" />
          <p>
            Solo el TAG es obligatorio. N° de serie, modelo y otros datos que no se conozcan ahora
            los releva el taller en campo y quedan incorporados a esta ficha desde el certificado.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <CampoTexto form={form} name="tag" label="TAG" placeholder="PSV-2752" autoFocus />
          <CampoTexto form={form} name="precinto" label="Precinto" />
          <CampoTexto form={form} name="servicio" label="Servicio" placeholder="GAS COMBUSTIBLE" />
          <CampoTexto form={form} name="marca" label="Marca" />
          <CampoTexto form={form} name="nroSerie" label="N° de serie" />
          <CampoTexto form={form} name="modelo" label="Modelo" />
          {select("tipo", "Tipo de funcionamiento", valores(tipo))}
          <CampoTexto form={form} name="pv" label="PV (variable de proceso)" placeholder="GAS" />
          {select("rosca", "Rosca", valores(rosca))}
          {combo("diamEntrada", "Ø Entrada / #", valores(diamEntrada))}
          {combo("diamSalida", "Ø Salida / #", valores(diamSalida))}
          <div className="grid grid-cols-2 gap-4">
            <CampoTexto
              form={form}
              name="presionOperacion"
              label="P. operación"
              inputMode="decimal"
              placeholder="kg/cm²"
            />
            <CampoTexto
              form={form}
              name="temperaturaOperacion"
              label="T° operación"
              inputMode="decimal"
              placeholder="°C"
            />
          </div>
        </div>

        <Field>
          <FieldLabel htmlFor="notas">Notas</FieldLabel>
          <Textarea id="notas" rows={2} {...form.register("notas")} />
        </Field>

        <Pie pendiente={guardar.isPending} cerrar={cerrar} crear={!valvula} />
      </FieldGroup>
    </form>
  )
}
