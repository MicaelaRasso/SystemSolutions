"use client"


import { useEffect, useMemo, useState } from "react"

import { Combobox } from "@/components/common/combobox"
import { SelectNativo } from "@/components/common/select-nativo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type {
  CertificateCaptureCatalogsDto,
  CertificateOption,
  CertificateOptionValue,
  CertificateTemplateDto,
  CertificateTemplateFieldType,
  UpdateCertificateDraftInput,
} from "@/lib/api/contracts"
import { CERTIFICATE_EVIDENCE_SECTIONS } from "@/lib/api/certificates"
import { CATALOGO_SEMILLA } from "@/lib/domain/catalogos"

type EvidenceKey = (typeof CERTIFICATE_EVIDENCE_SECTIONS)[number]["key"]

export type TechnicalData = {
  tag: string
  precinto: string
  servicio: string
  marca: string
  numero_serie: string
  modelo: string
  tipo: string
  pv: string
  rosca: string
  diametro_entrada: string
  clase_entrada: string
  diametro_salida: string
  clase_salida: string
  presion_operacion: string
  temperatura_operacion: string
  razon_disponibilidad: "" | "not_applicable" | "not_found"
}

type TestData = {
  sp_inicial: { valor: string; unidad: string }
  sp_apertura: { valor: string; unidad: string }
  presion_cierre: { valor: string; unidad: string }
  patron: CertificateOption | null
}

type FormState = {
  fecha_ejecucion: string
  tecnico_ejecutor: string
  technical: TechnicalData
  tests: TestData
  maintenance: CertificateOptionValue[]
  replacements: CertificateOptionValue[]
  otherParts: string
  observations: string
  customFields: Record<string, unknown>
}

type ValveLike = Record<string, unknown>

type CaptureCatalogs = Pick<
  CertificateCaptureCatalogsDto,
  | "maintenance"
  | "replacement_catalog_version"
  | "replacement_parts"
  | "units"
  | "standards"
> &
  Partial<
    Pick<CertificateCaptureCatalogsDto, "diam_entrada" | "diam_salida" | "rosca" | "tipo">
  >

type CertificateCaptureFormProps = {
  template: CertificateTemplateDto
  catalogs: CaptureCatalogs
  technicians: { id?: string; name?: string; nombre?: string; apellido?: string }[]
  certificate?: Record<string, unknown>
  valve?: ValveLike
  evidence?: Partial<Record<EvidenceKey, unknown>>
  disabled?: boolean
  onCapturePhoto?: (section: EvidenceKey, file: File | undefined) => void
  onSave: (payload: UpdateCertificateDraftInput) => void
}

const emptyTechnical = (): TechnicalData => ({
  tag: "",
  precinto: "",
  servicio: "",
  marca: "",
  numero_serie: "",
  modelo: "",
  tipo: "",
  pv: "",
  rosca: "",
  diametro_entrada: "",
  clase_entrada: "",
  diametro_salida: "",
  clase_salida: "",
  presion_operacion: "",
  temperatura_operacion: "",
  razon_disponibilidad: "",
})

const FIELD_ALIASES: Record<Exclude<keyof TechnicalData, "razon_disponibilidad">, string[]> = {
  tag: ["tag", "nombre", "name"],
  precinto: ["precinto"],
  servicio: ["servicio"],
  marca: ["marca"],
  numero_serie: ["numero_serie", "nroSerie", "nro_serie", "serie"],
  modelo: ["modelo"],
  tipo: ["tipo"],
  pv: ["pv", "variable_proceso", "variableProceso"],
  rosca: ["rosca"],
  diametro_entrada: ["diametro_entrada", "diamEntrada"],
  clase_entrada: ["clase_entrada", "claseEntrada"],
  diametro_salida: ["diametro_salida", "diamSalida"],
  clase_salida: ["clase_salida", "claseSalida"],
  presion_operacion: ["presion_operacion", "presionOperacion", "p_operacion"],
  temperatura_operacion: ["temperatura_operacion", "temperaturaOperacion", "t_operacion"],
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value)
}

function catalogLabels(options: CertificateOption[] | undefined, fallback: string[]): string[] {
  const labels = (options ?? []).map((item) => item.label.trim()).filter(Boolean)
  return labels.length > 0 ? labels : fallback
}

function optionsWithCurrent(options: string[], currentValue: string): string[] {
  const trimmed = currentValue.trim()
  if (!trimmed || options.includes(trimmed)) return options
  return [trimmed, ...options]
}

function combineDiameterAndClass(diam: string, clase: string, catalogOptions: string[]): string {
  const d = diam.trim()
  const c = clase.trim()
  if (!d) return ""
  if (!c || d.includes("#")) return d
  const cleanClass = c.replace(/^#/, "")
  const candidate1 = `${d}#${cleanClass}`
  const candidate2 = `${d}"#${cleanClass}`
  if (catalogOptions.includes(candidate1)) return candidate1
  if (catalogOptions.includes(candidate2)) return candidate2
  return candidate1
}

export function resolveTechnicalData(
  certificate: Record<string, unknown> | undefined,
  valve: ValveLike | undefined,
  catalogs?: CaptureCatalogs,
): TechnicalData {
  const certificateTechnical = objectValue(certificate?.datos_tecnicos)
  const savedTechnical = objectValue(
    certificateTechnical.valvula ?? certificateTechnical.valve ?? certificateTechnical,
  )
  const savedCustom = objectValue(certificate?.campos_personalizados)
  const contextoCaptura = objectValue(certificate?.contexto_captura)
  const instantanea = objectValue(certificate?.instantanea)
  const snapshotValve = {
    ...objectValue(instantanea.valvula ?? instantanea.valve),
    ...objectValue(contextoCaptura.valvula ?? contextoCaptura.valve),
  }
  const valveProp = objectValue(valve)

  // Priority order for prefilling: explicit draft technical data -> custom fields -> live valve -> snapshot valve.
  // Empty strings in an uncompleted draft never mask known valve attributes.
  const sources = [savedTechnical, savedCustom, valveProp, snapshotValve]
  const pickNonEmpty = (aliases: string[]) => {
    for (const source of sources) {
      for (const alias of aliases) {
        const candidate = textValue(source[alias]).trim()
        if (candidate !== "") return candidate
      }
    }
    return ""
  }

  const technical = emptyTechnical()
  for (const key of Object.keys(FIELD_ALIASES) as (keyof typeof FIELD_ALIASES)[]) {
    technical[key] = pickNonEmpty(FIELD_ALIASES[key])
  }

  const diamEntradaCatalog = catalogLabels(catalogs?.diam_entrada, CATALOGO_SEMILLA.diamEntrada)
  const diamSalidaCatalog = catalogLabels(catalogs?.diam_salida, CATALOGO_SEMILLA.diamSalida)

  if (technical.diametro_entrada && technical.clase_entrada) {
    technical.diametro_entrada = combineDiameterAndClass(
      technical.diametro_entrada,
      technical.clase_entrada,
      diamEntradaCatalog,
    )
    technical.clase_entrada = ""
  }
  if (technical.diametro_salida && technical.clase_salida) {
    technical.diametro_salida = combineDiameterAndClass(
      technical.diametro_salida,
      technical.clase_salida,
      diamSalidaCatalog,
    )
    technical.clase_salida = ""
  }

  for (const source of sources) {
    const reason = source.razon_disponibilidad ?? source.razonDisponibilidad
    if (reason === "not_applicable" || reason === "not_found") {
      technical.razon_disponibilidad = reason
      break
    }
  }

  return technical
}

function optionValue(
  value: unknown,
  options: CertificateOption[],
): CertificateOption | string | null {
  if (typeof value === "string" && value.trim())
    return options.find((option) => option.label === value) ?? value
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    const id = String((value as { id: string }).id)
    const savedLabel = textValue((value as { label?: unknown }).label)
    return savedLabel
      ? { id, label: savedLabel }
      : options.find((option) => option.id === id) ?? { id, label: id }
  }
  return null
}

function normalizeOptions(value: unknown, options: CertificateOption[]) {
  return Array.isArray(value)
    ? value
        .map((item) => optionValue(item, options))
        .filter((item): item is CertificateOption | string => Boolean(item))
    : []
}

function initialState(
  certificate: Record<string, unknown> | undefined,
  valve: ValveLike | undefined,
  catalogs: CaptureCatalogs,
): FormState {
  const certificateTechnical = objectValue(certificate?.datos_tecnicos)
  const savedTests = objectValue(certificateTechnical.ensayos ?? certificateTechnical.tests)
  const savedParts = objectValue(certificate?.repuestos)
  const savedCustom = objectValue(certificate?.campos_personalizados)
  const technical = resolveTechnicalData(certificate, valve, catalogs)

  const test = (key: keyof Omit<TestData, "patron">) => {
    const raw = objectValue(savedTests[key])
    return { valor: textValue(raw.valor), unidad: textValue(raw.unidad) }
  }
  const selectedStandard = optionValue(savedTests.patron, catalogs.standards)
  return {
    fecha_ejecucion: textValue(certificate?.fecha_ejecucion),
    tecnico_ejecutor: textValue(certificate?.tecnico_ejecutor),
    technical,
    tests: {
      sp_inicial: test("sp_inicial"),
      sp_apertura: test("sp_apertura"),
      presion_cierre: test("presion_cierre"),
      patron: selectedStandard && typeof selectedStandard !== "string" ? selectedStandard : null,
    },
    maintenance: normalizeOptions(certificate?.alcance_mantenimiento, catalogs.maintenance),
    replacements: normalizeOptions(savedParts.items, catalogs.replacement_parts),
    otherParts: textValue(savedParts.otros),
    observations: textValue(certificate?.observaciones),
    customFields: savedCustom,
  }
}

function selected(option: CertificateOptionValue, values: CertificateOptionValue[]) {
  const id = typeof option === "string" ? option : option.id
  return values.some((value) => (typeof value === "string" ? value : value.id) === id)
}

function toggleOption(option: CertificateOption, values: CertificateOptionValue[]) {
  return selected(option, values)
    ? values.filter((value) => (typeof value === "string" ? value : value.id) !== option.id)
    : [...values, option]
}

function fieldValueIsPresent(value: unknown) {
  return (
    value === true ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.trim().length > 0)
  )
}

function DynamicField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: CertificateTemplateDto["campos"][number]
  value: unknown
  disabled: boolean
  onChange: (value: unknown) => void
}) {
  const id = `certificate-custom-${field.clave}`
  const options = field.opciones ?? []
  const type: CertificateTemplateFieldType = field.tipo
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>
        {field.etiqueta}
        {field.obligatorio ? " *" : ""}
      </Label>
      {type === "textarea" ? (
        <Textarea
          id={id}
          value={textValue(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      ) : null}
      {type === "boolean" ? (
        <label className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
          <Checkbox
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked === true)}
            disabled={disabled}
          />{" "}
          Sí
        </label>
      ) : null}
      {type === "select" ? (
        <SelectNativo
          id={id}
          value={textValue(value)}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        >
          <option value="">Seleccionar</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </SelectNativo>
      ) : null}
      {type === "multiselect" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
              <Checkbox
                checked={Array.isArray(value) && value.includes(option.id)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...(Array.isArray(value) ? value : []), option.id]
                      : Array.isArray(value)
                        ? value.filter((item) => item !== option.id)
                        : [],
                  )
                }
                disabled={disabled}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>
      ) : null}
      {type !== "textarea" && type !== "boolean" && type !== "select" && type !== "multiselect" ? (
        <Input
          id={id}
          type={type === "number" ? "number" : type === "date" ? "date" : "text"}
          inputMode={type === "number" ? "decimal" : undefined}
          value={textValue(value)}
          onChange={(event) =>
            onChange(
              type === "number"
                ? event.target.value === ""
                  ? ""
                  : Number(event.target.value)
                : event.target.value,
            )
          }
          disabled={disabled}
        />
      ) : null}
    </div>
  )
}

export function CertificateCaptureForm({
  template,
  catalogs,
  technicians,
  certificate,
  valve,
  evidence,
  disabled = false,
  onCapturePhoto,
  onSave,
}: CertificateCaptureFormProps) {
  const [form, setForm] = useState(() => initialState(certificate, valve, catalogs))
  const technicianNames = useMemo(
    () =>
      technicians
        .map((person) => [person.name ?? person.nombre, person.apellido].filter(Boolean).join(" "))
        .filter(Boolean),
    [technicians],
  )
  const [customTechnician, setCustomTechnician] = useState(
    () =>
      Boolean(form.tecnico_ejecutor) &&
      technicians.length > 0 &&
      !technicians.some(
        (person) =>
          [person.name ?? person.nombre, person.apellido].filter(Boolean).join(" ") ===
          form.tecnico_ejecutor,
      ),
  )
  const [replacementCatalogVersion] = useState(() => {
    const savedParts = objectValue(certificate?.repuestos)
    const savedVersion = textValue(savedParts.catalog_version).trim()
    return savedVersion || catalogs.replacement_catalog_version
  })
  const [errors, setErrors] = useState<string[]>([])

  // Auto-complete any technical field that is still empty if pre-existing valve or draft data arrives.
  useEffect(() => {
    const resolved = resolveTechnicalData(certificate, valve, catalogs)
    setForm((current) => {
      let changed = false
      const nextTechnical = { ...current.technical }
      for (const key of Object.keys(nextTechnical) as (keyof TechnicalData)[]) {
        if (!nextTechnical[key] && resolved[key]) {
          nextTechnical[key] = resolved[key] as never
          changed = true
        }
      }
      return changed ? { ...current, technical: nextTechnical } : current
    })
  }, [catalogs, certificate, valve])

  const opcionesTipo = useMemo(
    () =>
      optionsWithCurrent(
        catalogLabels(catalogs.tipo, CATALOGO_SEMILLA.tipo),
        form.technical.tipo,
      ),
    [catalogs.tipo, form.technical.tipo],
  )
  const opcionesRosca = useMemo(
    () =>
      optionsWithCurrent(
        catalogLabels(catalogs.rosca, CATALOGO_SEMILLA.rosca),
        form.technical.rosca,
      ),
    [catalogs.rosca, form.technical.rosca],
  )
  const opcionesDiamEntrada = useMemo(
    () =>
      optionsWithCurrent(
        catalogLabels(catalogs.diam_entrada, CATALOGO_SEMILLA.diamEntrada),
        form.technical.diametro_entrada,
      ),
    [catalogs.diam_entrada, form.technical.diametro_entrada],
  )
  const opcionesDiamSalida = useMemo(
    () =>
      optionsWithCurrent(
        catalogLabels(catalogs.diam_salida, CATALOGO_SEMILLA.diamSalida),
        form.technical.diametro_salida,
      ),
    [catalogs.diam_salida, form.technical.diametro_salida],
  )

  const customFields = useMemo(
    () =>
      template.campos
        .filter(
          (field) =>
            !["fecha_ejecucion", "tecnico_ejecutor", "observaciones"].includes(field.clave),
        )
        .sort((a, b) => a.orden - b.orden),
    [template.campos],
  )
  const groupedCustomFields = useMemo(
    () =>
      customFields.reduce<Record<string, typeof customFields>>((groups, field) => {
        ;(groups[field.seccion] ??= []).push(field)
        return groups
      }, {}),
    [customFields],
  )

  function validate() {
    const next: string[] = []
    if (!form.fecha_ejecucion) next.push("Fecha de ejecución")
    if (!form.tecnico_ejecutor) next.push("Técnico ejecutor")
    for (const [key, test] of Object.entries(form.tests)) {
      if (key === "patron") continue
      const row = test as { valor: string; unidad: string }
      if (!row.valor || !Number.isFinite(Number(row.valor))) next.push(`Resultado ${key}`)
      if (!row.unidad) next.push(`Unidad ${key}`)
    }
    if (!form.tests.patron) next.push("Patrón de referencia")
    for (const field of customFields) {
      if (field.obligatorio && !fieldValueIsPresent(form.customFields[field.clave]))
        next.push(field.etiqueta)
    }
    setErrors(next)
    return next.length === 0
  }

  function save() {
    if (!validate()) return

    const allowedCustomKeys = new Set(template.campos.map((c) => c.clave))
    const cleanCustomFields: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(form.customFields)) {
      if (allowedCustomKeys.has(key)) {
        cleanCustomFields[key] = val
      }
    }

    const cleanMaintenance = form.maintenance.map((item) =>
      typeof item === "string" ? item : { id: item.id, label: item.label },
    )

    const cleanReplacements = form.replacements.map((item) =>
      typeof item === "string" ? item : { id: item.id, label: item.label },
    )

    const cleanPatron = form.tests.patron
      ? { id: form.tests.patron.id, label: form.tests.patron.label }
      : null

    onSave({
      fecha_ejecucion: form.fecha_ejecucion,
      tecnico_ejecutor: form.tecnico_ejecutor,
      datos_tecnicos: {
        valvula: {
          ...form.technical,
          tag: form.technical.tag.trim().toUpperCase(),
          razon_disponibilidad: form.technical.razon_disponibilidad || null,
        },
        ensayos: {
          sp_inicial: {
            valor: Number(form.tests.sp_inicial.valor),
            unidad: form.tests.sp_inicial.unidad,
          },
          sp_apertura: {
            valor: Number(form.tests.sp_apertura.valor),
            unidad: form.tests.sp_apertura.unidad,
          },
          presion_cierre: {
            valor: Number(form.tests.presion_cierre.valor),
            unidad: form.tests.presion_cierre.unidad,
          },
          patron: cleanPatron,
        },
      },
      campos_personalizados: cleanCustomFields,
      alcance_mantenimiento: cleanMaintenance,
      repuestos: {
        catalog_version: replacementCatalogVersion,
        items: cleanReplacements,
        otros: form.otherParts.trim() || null,
      },
      evidencia_fotografica: {
        desarmada: evidence?.desarmada ?? null,
        ensamblada_prueba: evidence?.ensamblada_prueba ?? null,
        placa_precinto: evidence?.placa_precinto ?? null,
      },
      observaciones: form.observations.trim() || null,
    })
  }

  const sectionTitle = (section: string) =>
    section.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  const updateTechnical = (key: keyof TechnicalData, value: string) =>
    setForm((current) => ({ ...current, technical: { ...current.technical, [key]: value } }))
  const updateTest = (
    key: keyof Omit<TestData, "patron">,
    part: "valor" | "unidad",
    value: string,
  ) =>
    setForm((current) => ({
      ...current,
      tests: { ...current.tests, [key]: { ...current.tests[key], [part]: value } },
    }))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Plantilla {template.version}</p>
        <Badge variant="outline">Campos tipados y catálogo activo</Badge>
      </div>
      {errors.length ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          Completá: {errors.join(", ")}
        </div>
      ) : null}
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Ejecución</CardTitle>
          <CardDescription>Datos obligatorios del trabajo en campo.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="certificate-execution-date">Fecha de ejecución *</Label>
            <Input
              id="certificate-execution-date"
              type="date"
              value={form.fecha_ejecucion}
              onChange={(event) =>
                setForm((current) => ({ ...current, fecha_ejecucion: event.target.value }))
              }
              disabled={disabled}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="certificate-technician">Técnico ejecutor *</Label>
            {technicians.length ? (
              <div className="space-y-2">
                <SelectNativo
                  id="certificate-technician"
                  value={
                    customTechnician
                      ? "__otro__"
                      : technicianNames.includes(form.tecnico_ejecutor)
                        ? form.tecnico_ejecutor
                        : ""
                  }
                  onChange={(event) => {
                    const value = event.target.value
                    if (value === "__otro__") {
                      setCustomTechnician(true)
                      if (technicianNames.includes(form.tecnico_ejecutor)) {
                        setForm((current) => ({ ...current, tecnico_ejecutor: "" }))
                      }
                      return
                    }
                    setCustomTechnician(false)
                    setForm((current) => ({ ...current, tecnico_ejecutor: value }))
                  }}
                  disabled={disabled}
                >
                  <option value="">Seleccionar Técnico</option>
                  {technicianNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                  <option value="__otro__">Otro técnico / Reemplazo…</option>
                </SelectNativo>
                {customTechnician ? (
                  <Input
                    id="certificate-technician-custom"
                    value={form.tecnico_ejecutor}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, tecnico_ejecutor: event.target.value }))
                    }
                    placeholder="Nombre y apellido del técnico reemplazante"
                    disabled={disabled}
                  />
                ) : null}
              </div>
            ) : (
              <Input
                id="certificate-technician"
                value={form.tecnico_ejecutor}
                onChange={(event) =>
                  setForm((current) => ({ ...current, tecnico_ejecutor: event.target.value }))
                }
                placeholder="Nombre del Técnico ejecutor"
                disabled={disabled}
              />
            )}
            {technicians.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                La nómina asignada no está disponible todavía.
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Datos técnicos de la Válvula</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field>
              <FieldLabel htmlFor="certificate-technical-tag">TAG</FieldLabel>
              <Input
                id="certificate-technical-tag"
                value={form.technical.tag}
                placeholder="PSV-2752"
                onChange={(event) => updateTechnical("tag", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-precinto">Precinto</FieldLabel>
              <Input
                id="certificate-technical-precinto"
                value={form.technical.precinto}
                onChange={(event) => updateTechnical("precinto", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-servicio">Servicio</FieldLabel>
              <Input
                id="certificate-technical-servicio"
                value={form.technical.servicio}
                placeholder="GAS COMBUSTIBLE"
                onChange={(event) => updateTechnical("servicio", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-marca">Marca</FieldLabel>
              <Input
                id="certificate-technical-marca"
                value={form.technical.marca}
                onChange={(event) => updateTechnical("marca", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-numero_serie">N° de serie</FieldLabel>
              <Input
                id="certificate-technical-numero_serie"
                value={form.technical.numero_serie}
                onChange={(event) => updateTechnical("numero_serie", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-modelo">Modelo</FieldLabel>
              <Input
                id="certificate-technical-modelo"
                value={form.technical.modelo}
                onChange={(event) => updateTechnical("modelo", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-tipo">Tipo de funcionamiento</FieldLabel>
              <Select
                value={form.technical.tipo}
                onValueChange={(value) => updateTechnical("tipo", value)}
                disabled={disabled}
              >
                <SelectTrigger id="certificate-technical-tipo" className="w-full">
                  <SelectValue placeholder="Seleccionar">
                    {form.technical.tipo || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {opcionesTipo.map((opcion) => (
                    <SelectItem key={opcion} value={opcion}>
                      {opcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-pv">PV (variable de proceso)</FieldLabel>
              <Input
                id="certificate-technical-pv"
                value={form.technical.pv}
                placeholder="GAS"
                onChange={(event) => updateTechnical("pv", event.target.value)}
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-rosca">Rosca</FieldLabel>
              <Select
                value={form.technical.rosca}
                onValueChange={(value) => updateTechnical("rosca", value)}
                disabled={disabled}
              >
                <SelectTrigger id="certificate-technical-rosca" className="w-full">
                  <SelectValue placeholder="Seleccionar">
                    {form.technical.rosca || undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {opcionesRosca.map((opcion) => (
                    <SelectItem key={opcion} value={opcion}>
                      {opcion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-diametro_entrada">
                Ø Entrada / #
              </FieldLabel>
              <Combobox
                id="certificate-technical-diametro_entrada"
                value={form.technical.diametro_entrada}
                onChange={(value) => updateTechnical("diametro_entrada", value)}
                opciones={opcionesDiamEntrada}
                placeholder="Seleccionar medida"
                buscar="Buscar medida…"
                disabled={disabled}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="certificate-technical-diametro_salida">
                Ø Salida / #
              </FieldLabel>
              <Combobox
                id="certificate-technical-diametro_salida"
                value={form.technical.diametro_salida}
                onChange={(value) => updateTechnical("diametro_salida", value)}
                opciones={opcionesDiamSalida}
                placeholder="Seleccionar medida"
                buscar="Buscar medida…"
                disabled={disabled}
              />
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="certificate-technical-presion_operacion">
                  P. operación
                </FieldLabel>
                <Input
                  id="certificate-technical-presion_operacion"
                  inputMode="decimal"
                  placeholder="kg/cm²"
                  value={form.technical.presion_operacion}
                  onChange={(event) => updateTechnical("presion_operacion", event.target.value)}
                  disabled={disabled}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="certificate-technical-temperatura_operacion">
                  T° operación
                </FieldLabel>
                <Input
                  id="certificate-technical-temperatura_operacion"
                  inputMode="decimal"
                  placeholder="°C"
                  value={form.technical.temperatura_operacion}
                  onChange={(event) =>
                    updateTechnical("temperatura_operacion", event.target.value)
                  }
                  disabled={disabled}
                />
              </Field>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="certificate-technical-availability">
              Disponibilidad de datos técnicos
            </Label>
            <SelectNativo
              id="certificate-technical-availability"
              value={form.technical.razon_disponibilidad}
              onChange={(event) => updateTechnical("razon_disponibilidad", event.target.value)}
              disabled={disabled}
            >
              <option value="">Dato disponible</option>
              <option value="not_found">Dato no encontrado</option>
              <option value="not_applicable">No aplica</option>
            </SelectNativo>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Ensayos y calibración</CardTitle>
          <CardDescription>
            Los resultados deben tener valor, unidad y patrón de referencia.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {(["sp_inicial", "sp_apertura", "presion_cierre"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`certificate-test-${key}`}>{sectionTitle(key)} *</Label>
                <Input
                  id={`certificate-test-${key}`}
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={form.tests[key].valor}
                  onChange={(event) => updateTest(key, "valor", event.target.value)}
                  disabled={disabled}
                />
                <SelectNativo
                  value={form.tests[key].unidad}
                  onChange={(event) => updateTest(key, "unidad", event.target.value)}
                  disabled={disabled}
                >
                  <option value="">Unidad *</option>
                  {catalogs.units.map((unit) => (
                    <option key={unit.id} value={unit.label}>
                      {unit.label}
                    </option>
                  ))}
                </SelectNativo>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="certificate-standard">Patrón de referencia *</Label>
            <SelectNativo
              id="certificate-standard"
              value={form.tests.patron?.id ?? ""}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  tests: {
                    ...current.tests,
                    patron:
                      catalogs.standards.find((standard) => standard.id === event.target.value) ??
                      null,
                  },
                }))
              }
              disabled={disabled}
            >
              <option value="">Seleccionar patrón</option>
              {catalogs.standards.map((standard) => (
                <option key={standard.id} value={standard.id}>
                  {standard.label}
                </option>
              ))}
            </SelectNativo>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Mantenimiento y repuestos</CardTitle>
          <CardDescription>

          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <OptionChecklist
            title="Alcance de mantenimiento"
            options={catalogs.maintenance}
            values={form.maintenance}
            disabled={disabled}
            onChange={(values) => setForm((current) => ({ ...current, maintenance: values }))}
          />
          <OptionChecklist
            title="Repuestos"
            options={catalogs.replacement_parts}
            values={form.replacements}
            disabled={disabled}
            onChange={(values) => setForm((current) => ({ ...current, replacements: values }))}
          />
          <div className="space-y-1">
            <Label htmlFor="certificate-other-parts">Otros repuestos</Label>
            <Input
              id="certificate-other-parts"
              value={form.otherParts}
              onChange={(event) =>
                setForm((current) => ({ ...current, otherParts: event.target.value }))
              }
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      {Object.entries(groupedCustomFields).map(([section, fields]) => (
        <Card size="sm" key={section}>
          <CardHeader>
            <CardTitle className="text-sm">{sectionTitle(section)}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <DynamicField
                key={field.clave}
                field={field}
                value={form.customFields[field.clave]}
                disabled={disabled}
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    customFields: { ...current.customFields, [field.clave]: value },
                  }))
                }
              />
            ))}
          </CardContent>
        </Card>
      ))}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Evidencia y observaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {CERTIFICATE_EVIDENCE_SECTIONS.map(({ key, label }) => (
              <Label key={key} className="rounded-md border p-3 text-sm">
                <span>{label}</span>
                <Input
                  type="file"
                  accept="image/*"
                  className="mt-2 h-auto py-2 pointer-coarse:h-auto"
                  onChange={(event) => onCapturePhoto?.(key, event.target.files?.[0])}
                  disabled={disabled}
                />
              </Label>
            ))}
          </div>
          <Textarea
            value={form.observations}
            onChange={(event) =>
              setForm((current) => ({ ...current, observations: event.target.value }))
            }
            placeholder="Observaciones del campo"
            disabled={disabled}
          />
        </CardContent>
      </Card>
      {/* Barra fija: en un formulario largo el guardado queda siempre al alcance del pulgar. */}
      <div className="sticky bottom-0 z-10 -mx-2 border-t bg-background px-2 py-2 sm:mx-0 sm:px-0">
        <Button className="w-full sm:w-auto" onClick={save} disabled={disabled}>
          {disabled ? "Certificado cerrado" : "Guardar Borrador de certificado"}
        </Button>
      </div>
    </div>
  )
}

function OptionChecklist({
  title,
  options,
  values,
  disabled,
  onChange,
}: {
  title: string
  options: CertificateOption[]
  values: CertificateOptionValue[]
  disabled: boolean
  onChange: (values: CertificateOptionValue[]) => void
}) {
  const savedInactive = values.filter((value) =>
    typeof value === "string"
      ? !options.some((option) => option.id === value || option.label === value)
      : !options.some((option) => option.id === value.id),
  )
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{title}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.id} className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
            <Checkbox
              checked={selected(option, values)}
              onCheckedChange={() => onChange(toggleOption(option, values))}
              disabled={disabled}
            />{" "}
            {option.label}
          </label>
        ))}
        {savedInactive.map((value, index) => (
          <label key={`saved-${index}`} className="flex items-center gap-2 text-sm pointer-coarse:min-h-11">
            <Checkbox
              checked
              onCheckedChange={() =>
                onChange(values.filter((item) => item !== value))
              }
              disabled={disabled}
            />{" "}
            {typeof value === "string" ? value : value.label} (guardada; ya no activa)
          </label>
        ))}
      </div>
      {options.length === 0 && savedInactive.length === 0 ? (
        <p className="text-xs text-muted-foreground">No hay opciones activas configuradas.</p>
      ) : null}
    </div>
  )
}
