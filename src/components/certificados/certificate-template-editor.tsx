"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Save, Sparkles } from "lucide-react"

import { ErrorState } from "@/components/common/states"
import { PageHeader } from "@/components/common/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  useActivateEdgeCertificateTemplate,
  useCreateEdgeCertificateTemplate,
  useEdgeCertificateTemplates,
  useUpdateEdgeCertificateTemplate,
} from "@/lib/api/hooks"
import type { CertificateTemplateDto, CertificateTemplateFieldType } from "@/lib/api/contracts"

type EditableField = CertificateTemplateDto["campos"][number]

const fieldTypes: CertificateTemplateFieldType[] = [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "boolean",
]

const newField = (order: number): EditableField => ({
  clave: `campo_${order}`,
  etiqueta: "Nuevo campo",
  tipo: "text",
  seccion: "personalizado",
  orden: order,
  obligatorio: false,
  opciones: [],
})

function copyFields(fields: EditableField[]) {
  return fields.map((field) => ({
    ...field,
    opciones: field.opciones.map((option) => ({ ...option })),
  }))
}

function optionId(label: string) {
  return (
    label
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "opcion"
  )
}

export function CertificateTemplateEditor() {
  const query = useEdgeCertificateTemplates()
  const create = useCreateEdgeCertificateTemplate()
  const update = useUpdateEdgeCertificateTemplate()
  const activate = useActivateEdgeCertificateTemplate()
  const [selectedId, setSelectedId] = useState<string>()
  const [edits, setEdits] = useState<Record<string, { version: string; fields: EditableField[] }>>(
    {},
  )
  const [message, setMessage] = useState<string>()

  const active = query.data?.find((template) => template.estado === "activa")
  const selected =
    query.data?.find((template) => template.id === selectedId) ?? active ?? query.data?.[0]
  const edit = selected ? edits[selected.id] : undefined
  const version = edit?.version ?? selected?.version ?? ""
  const fields = edit?.fields ?? selected?.campos ?? []

  function selectTemplate(template: CertificateTemplateDto) {
    setSelectedId(template.id)
    setMessage(undefined)
  }

  function startDraft() {
    if (!active) return
    const suffix = new Date()
      .toISOString()
      .replace(/[-:TZ.]/g, "")
      .slice(0, 12)
    create.mutate(
      { version: `${active.version}-v${suffix}`, campos: copyFields(active.campos) },
      {
        onSuccess: (template) => {
          setSelectedId(template.id)
          setEdits((current) => ({
            ...current,
            [template.id]: { version: template.version, fields: copyFields(template.campos) },
          }))
          setMessage("Borrador de plantilla creado.")
        },
      },
    )
  }

  function saveDraft() {
    if (!selectedId || !version.trim()) return
    update.mutate(
      {
        id: selectedId,
        input: {
          version: version.trim(),
          campos: fields.map((field, index) => ({ ...field, orden: index + 1 })),
        },
      },
      {
        onSuccess: (template) => {
          setEdits((current) => ({
            ...current,
            [template.id]: { version: template.version, fields: copyFields(template.campos) },
          }))
          setMessage("Cambios guardados en el borrador.")
        },
      },
    )
  }

  function activateDraft() {
    if (!selectedId) return
    activate.mutate(selectedId, {
      onSuccess: () => setMessage("Nueva versión activa. La anterior quedó histórica."),
    })
  }

  function patchField(index: number, patch: Partial<EditableField>) {
    if (!selected) return
    setEdits((current) => ({
      ...current,
      [selected.id]: {
        version,
        fields: fields.map((field, fieldIndex) =>
          fieldIndex === index ? { ...field, ...patch } : field,
        ),
      },
    }))
  }

  function moveField(index: number, direction: -1 | 1) {
    if (!selected) return
    const destination = index + direction
    if (destination < 0 || destination >= fields.length) return
    const next = [...fields]
    ;[next[index], next[destination]] = [next[destination], next[index]]
    setEdits((current) => ({ ...current, [selected.id]: { version, fields: next } }))
  }

  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Configuración del certificado"
        descripcion="Administrá la Plantilla de certificado y sus versiones. Los certificados históricos conservan la versión y la definición usada al capturarlos."
        acciones={
          <Button onClick={startDraft} disabled={!active || create.isPending}>
            <Plus className="mr-2 size-4" /> Nueva versión
          </Button>
        }
      />
      {message ? (
        <p
          className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900"
          role="status"
        >
          {message}
        </p>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Versiones</CardTitle>
            <CardDescription>
              Solo una versión está disponible para nuevos borradores.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {query.isPending ? (
              <div className="h-20 animate-pulse rounded bg-muted" />
            ) : (
              query.data?.map((template) => (
                <button
                  type="button"
                  key={template.id}
                  onClick={() => selectTemplate(template)}
                  className={`w-full rounded-lg border p-3 text-left ${template.id === selected?.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{template.version}</span>
                    <Badge
                      variant={
                        template.estado === "activa"
                          ? "default"
                          : template.estado === "borrador"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {template.estado}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {template.campos.length} campo(s)
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {selected?.estado === "borrador"
                    ? "Editar versión borrador"
                    : "Detalle de versión"}
                </CardTitle>
                <CardDescription>
                  {selected?.estado === "activa"
                    ? "La versión activa es de solo lectura. Creá una nueva versión para modificarla."
                    : "Los cambios quedan en borrador hasta activar esta versión."}
                </CardDescription>
              </div>
              {selected?.estado === "borrador" ? (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={saveDraft} disabled={update.isPending}>
                    <Save className="mr-2 size-4" /> Guardar
                  </Button>
                  <Button onClick={activateDraft} disabled={activate.isPending}>
                    <CheckCircle2 className="mr-2 size-4" /> Activar
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="certificate-template-version">Identificador de versión</Label>
                  <Input
                    id="certificate-template-version"
                    value={version}
                    onChange={(event) =>
                      selected &&
                      setEdits((current) => ({
                        ...current,
                        [selected.id]: { version: event.target.value, fields },
                      }))
                    }
                    disabled={selected.estado !== "borrador"}
                  />
                </div>
                <div className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 text-sm">
                  <Sparkles className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Los campos se capturan con su clave, etiqueta, sección, tipo, orden y condición
                    obligatoria. Activar crea un corte histórico; no modifica certificados ya
                    emitidos.
                  </span>
                </div>
                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <FieldEditor
                      key={`${field.clave}-${index}`}
                      field={field}
                      index={index}
                      editable={selected.estado === "borrador"}
                      first={index === 0}
                      last={index === fields.length - 1}
                      onChange={(patch) => patchField(index, patch)}
                      onMove={(direction) => moveField(index, direction)}
                    />
                  ))}
                  {selected.estado === "borrador" ? (
                    <Button
                      variant="outline"
                      onClick={() =>
                        selected &&
                        setEdits((current) => ({
                          ...current,
                          [selected.id]: {
                            version,
                            fields: [...fields, newField(fields.length + 1)],
                          },
                        }))
                      }
                    >
                      <Plus className="mr-2 size-4" /> Agregar campo
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Seleccioná una versión para ver su definición.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function FieldEditor({
  field,
  index,
  editable,
  first,
  last,
  onChange,
  onMove,
}: {
  field: EditableField
  index: number
  editable: boolean
  first: boolean
  last: boolean
  onChange: (patch: Partial<EditableField>) => void
  onMove: (direction: -1 | 1) => void
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Campo {index + 1}</p>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(-1)}
            disabled={!editable || first}
            aria-label="Mover campo arriba"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onMove(1)}
            disabled={!editable || last}
            aria-label="Mover campo abajo"
          >
            <ArrowDown className="size-4" />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Clave estable</Label>
          <Input
            value={field.clave}
            onChange={(event) => onChange({ clave: event.target.value })}
            disabled={!editable}
          />
        </div>
        <div className="space-y-1">
          <Label>Etiqueta</Label>
          <Input
            value={field.etiqueta}
            onChange={(event) => onChange({ etiqueta: event.target.value })}
            disabled={!editable}
          />
        </div>
        <div className="space-y-1">
          <Label>Sección</Label>
          <Input
            value={field.seccion}
            onChange={(event) => onChange({ seccion: event.target.value })}
            disabled={!editable}
          />
        </div>
        <div className="space-y-1">
          <Label>Tipo</Label>
          <select
            className="h-8 w-full rounded-lg border bg-transparent px-2 text-sm"
            value={field.tipo}
            onChange={(event) =>
              onChange({ tipo: event.target.value as CertificateTemplateFieldType })
            }
            disabled={!editable}
          >
            {fieldTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Switch
          checked={field.obligatorio}
          onCheckedChange={(checked) => onChange({ obligatorio: checked })}
          disabled={!editable}
        />
        <Label>Campo obligatorio</Label>
      </div>
      {field.tipo === "select" || field.tipo === "multiselect" ? (
        <div className="mt-3 space-y-1">
          <Label>Opciones (separadas por coma)</Label>
          <Input
            value={field.opciones.map((option) => option.label).join(", ")}
            onChange={(event) =>
              onChange({
                opciones: event.target.value
                  .split(",")
                  .map((label) => label.trim())
                  .filter(Boolean)
                  .map((label) => ({ id: optionId(label), label })),
              })
            }
            disabled={!editable}
          />
        </div>
      ) : null}
    </div>
  )
}
