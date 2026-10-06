"use client"

import { useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type {
  CertificateCaptureCatalogsDto,
  CertificateOption,
  CertificateOptionValue,
  CertificateTemplateFieldType,
  CertificateTemplateDto,
  UpdateCertificateDraftInput,
} from "@/lib/api/contracts"
import { CERTIFICATE_EVIDENCE_SECTIONS } from "@/lib/api/certificates"

type EvidenceKey = (typeof CERTIFICATE_EVIDENCE_SECTIONS)[number]["key"]

type TechnicalData = {
  marca: string
  numero_serie: string
  modelo: string
  tipo: string
  diametro_entrada: string
  clase_entrada: string
  diametro_salida: string
  clase_salida: string
  rosca: string
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

type CertificateCaptureFormProps = {
  template: CertificateTemplateDto
  catalogs: Pick<
    CertificateCaptureCatalogsDto,
    | "maintenance"
    | "replacement_catalog_version"
    | "replacement_parts"
    | "units"
    | "standards"
  >
  technicians: { id?: string; name?: string; nombre?: string; apellido?: string }[]
  certificate?: Record<string, unknown>
  valve?: ValveLike
  evidence?: Partial<Record<EvidenceKey, unknown>>
  disabled?: boolean
  onCapturePhoto?: (section: EvidenceKey, file: File | undefined) => void
  onSave: (payload: UpdateCertificateDraftInput) => void
}

const emptyTechnical = (): TechnicalData => ({
  marca: "",
  numero_serie: "",
  modelo: "",
  tipo: "",
  diametro_entrada: "",
  clase_entrada: "",
  diametro_salida: "",
  clase_salida: "",
  rosca: "",
  razon_disponibilidad: "",
})

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value)
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
  catalogs: CertificateCaptureFormProps["catalogs"],
): FormState {
  const certificateTechnical = objectValue(certificate?.datos_tecnicos)
  const savedTechnical = objectValue(
    certificateTechnical.valvula ?? certificateTechnical.valve ?? certificateTechnical,
  )
  const savedTests = objectValue(certificateTechnical.ensayos ?? certificateTechnical.tests)
  const savedParts = objectValue(certificate?.repuestos)
  const savedCustom = objectValue(certificate?.campos_personalizados)
  const source = { ...valve, ...savedTechnical }
  const technical = emptyTechnical()
  for (const key of Object.keys(technical) as (keyof TechnicalData)[]) {
    const value = source[key]
    technical[key] =
      key === "razon_disponibilidad" && (value === "not_applicable" || value === "not_found")
        ? value
        : (textValue(value) as never)
  }
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

const technicalFields: { key: keyof TechnicalData; label: string }[] = [
  { key: "marca", label: "Marca" },
  { key: "numero_serie", label: "Número de serie" },
  { key: "modelo", label: "Modelo" },
  { key: "tipo", label: "Tipo" },
  { key: "diametro_entrada", label: "Diámetro entrada" },
  { key: "clase_entrada", label: "Clase entrada" },
  { key: "diametro_salida", label: "Diámetro salida" },
  { key: "clase_salida", label: "Clase salida" },
  { key: "rosca", label: "Rosca" },
]

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
        <label className="flex items-center gap-2 text-sm">
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
        <select
          id={id}
          className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
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
        </select>
      ) : null}
      {type === "multiselect" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {options.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm">
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
  const [replacementCatalogVersion] = useState(() => {
    const savedParts = objectValue(certificate?.repuestos)
    const savedVersion = textValue(savedParts.catalog_version).trim()
    return savedVersion || catalogs.replacement_catalog_version
  })
  const [errors, setErrors] = useState<string[]>([])

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
    onSave({
      fecha_ejecucion: form.fecha_ejecucion,
      tecnico_ejecutor: form.tecnico_ejecutor,
      datos_tecnicos: {
        valvula: form.technical,
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
          patron: form.tests.patron,
        },
      },
      campos_personalizados: form.customFields,
      alcance_mantenimiento: form.maintenance,
      repuestos: {
        catalog_version: replacementCatalogVersion,
        items: form.replacements,
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
              <select
                id="certificate-technician"
                className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
                value={form.tecnico_ejecutor}
                onChange={(event) =>
                  setForm((current) => ({ ...current, tecnico_ejecutor: event.target.value }))
                }
                disabled={disabled}
              >
                <option value="">Seleccionar Técnico</option>
                {technicians.map((person) => {
                  const name = [person.name ?? person.nombre, person.apellido]
                    .filter(Boolean)
                    .join(" ")
                  return (
                    <option key={person.id ?? name} value={name}>
                      {name}
                    </option>
                  )
                })}
              </select>
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
          <CardDescription>
            Se precargan los datos conocidos; podés indicar si un dato no está disponible o no
            aplica.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {technicalFields.map(({ key, label }) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`certificate-technical-${key}`}>{label}</Label>
              <Input
                id={`certificate-technical-${key}`}
                value={form.technical[key]}
                onChange={(event) => updateTechnical(key, event.target.value)}
                disabled={disabled}
              />
            </div>
          ))}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="certificate-technical-availability">
              Disponibilidad de datos técnicos
            </Label>
            <select
              id="certificate-technical-availability"
              className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
              value={form.technical.razon_disponibilidad}
              onChange={(event) => updateTechnical("razon_disponibilidad", event.target.value)}
              disabled={disabled}
            >
              <option value="">Dato disponible</option>
              <option value="not_found">Dato no encontrado</option>
              <option value="not_applicable">No aplica</option>
            </select>
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
                  step="any"
                  value={form.tests[key].valor}
                  onChange={(event) => updateTest(key, "valor", event.target.value)}
                  disabled={disabled}
                />
                <select
                  className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
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
                </select>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            <Label htmlFor="certificate-standard">Patrón de referencia *</Label>
            <select
              id="certificate-standard"
              className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
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
            </select>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Mantenimiento y repuestos</CardTitle>
          <CardDescription>
            Elegí opciones activas; los certificados guardan el ID y el texto mostrado.
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
              <Label key={key} className="rounded-md border p-2 text-xs">
                <span>{label}</span>
                <Input
                  type="file"
                  accept="image/*"
                  className="mt-2 h-auto"
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
      <Button size="sm" onClick={save} disabled={disabled}>
        {disabled ? "Certificado cerrado" : "Guardar Borrador de certificado"}
      </Button>
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
          <label key={option.id} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected(option, values)}
              onCheckedChange={() => onChange(toggleOption(option, values))}
              disabled={disabled}
            />{" "}
            {option.label}
          </label>
        ))}
        {savedInactive.map((value, index) => (
          <label key={`saved-${index}`} className="flex items-center gap-2 text-sm">
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
