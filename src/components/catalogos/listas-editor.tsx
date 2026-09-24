"use client"

import { ArrowDown, ArrowUp, Check, Pencil, Plus, Search, X } from "lucide-react"
import { useState } from "react"

import { ErrorState } from "@/components/common/states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { LISTA_CATALOGO_LABEL } from "@/lib/domain/catalogos"
import type { ListaCatalogo, OpcionCatalogo } from "@/lib/domain/types"
import {
  INVALIDAR_CATALOGOS,
  useCatalogoAdmin,
  useCatalogoResumen,
  useServiceMutation,
} from "@/lib/hooks/queries"
import { services } from "@/lib/services"
import { cn } from "@/lib/utils"

const GRUPOS: { titulo: string; listas: ListaCatalogo[] }[] = [
  { titulo: "Válvula (sección 1.1)", listas: ["tipo", "diamEntrada", "diamSalida", "rosca"] },
  { titulo: "Mantenimiento (sección 1.3)", listas: ["alcance", "repuestos"] },
  { titulo: "Ensayos (sección 1.5)", listas: ["unidad"] },
  { titulo: "Tareas", listas: ["condicionesServicio"] },
]

export function ListasEditor() {
  const [lista, setLista] = useState<ListaCatalogo>("tipo")
  const resumen = useCatalogoResumen()

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Selector: lista lateral en escritorio, desplegable en pantallas chicas */}
      <div className="lg:hidden">
        <Select value={lista} onValueChange={(v) => setLista(v as ListaCatalogo)}>
          <SelectTrigger className="w-full" aria-label="Lista">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRUPOS.map((g) => (
              <SelectGroup key={g.titulo}>
                <SelectLabel>{g.titulo}</SelectLabel>
                {g.listas.map((l) => (
                  <SelectItem key={l} value={l}>
                    {LISTA_CATALOGO_LABEL[l].titulo}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Listas" className="hidden space-y-4 rounded-xl border bg-card p-3 lg:block">
        {GRUPOS.map((g) => (
          <div key={g.titulo} className="space-y-1">
            <p className="px-2 text-xs font-medium text-muted-foreground">{g.titulo}</p>
            {g.listas.map((l) => {
              const r = resumen.data?.[l]
              return (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLista(l)}
                  aria-current={l === lista ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm",
                    l === lista ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  )}
                >
                  {LISTA_CATALOGO_LABEL[l].titulo}
                  {r && (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        l === lista ? "text-primary-foreground/80" : "text-muted-foreground",
                      )}
                    >
                      {r.activas}
                      {r.activas !== r.total && `/${r.total}`}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* key: reinicia búsqueda y edición al cambiar de lista */}
      <ListaEditor key={lista} lista={lista} />
    </div>
  )
}

function ListaEditor({ lista }: { lista: ListaCatalogo }) {
  const { data, isPending, isError, error, refetch } = useCatalogoAdmin(lista)
  const [nuevo, setNuevo] = useState("")
  const [busqueda, setBusqueda] = useState("")
  const info = LISTA_CATALOGO_LABEL[lista]

  const crear = useServiceMutation((valor: string) => services.catalogos.crear(lista, valor), {
    exito: "Opción agregada",
    invalidar: INVALIDAR_CATALOGOS,
  })
  const reordenar = useServiceMutation(
    (ids: string[]) => services.catalogos.reordenar(lista, ids),
    { invalidar: INVALIDAR_CATALOGOS },
  )

  function mover(indice: number, delta: -1 | 1) {
    if (!data) return
    const ids = data.map((o) => o.id)
    const destino = indice + delta
    ;[ids[indice], ids[destino]] = [ids[destino], ids[indice]]
    reordenar.mutate(ids)
  }

  function agregar(e: React.FormEvent) {
    e.preventDefault()
    if (!nuevo.trim()) return
    crear.mutate(nuevo, { onSuccess: () => setNuevo("") })
  }

  const q = busqueda.trim().toLowerCase()
  const visibles = (data ?? [])
    .map((o, indice) => ({ o, indice }))
    .filter(({ o }) => !q || o.valor.toLowerCase().includes(q))

  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">{info.titulo}</h2>
        <p className="text-sm text-muted-foreground">{info.descripcion}</p>
      </div>

      <form onSubmit={agregar} className="flex gap-2">
        <Input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Nueva opción"
          aria-label="Nueva opción"
          maxLength={60}
        />
        <Button type="submit" disabled={!nuevo.trim() || crear.isPending}>
          <Plus />
          Agregar
        </Button>
      </form>

      {(data?.length ?? 0) > 12 && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Filtrar opciones"
            className="pl-8"
            aria-label="Filtrar opciones"
          />
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Las opciones no se eliminan: si ya no se usan se desactivan, así los certificados emitidos
        conservan su valor. El orden es el que se ve en los formularios.
      </p>

      {isError ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <ol className="divide-y rounded-lg border">
          {visibles.map(({ o, indice }) => (
            <FilaOpcion
              key={o.id}
              opcion={o}
              indice={indice}
              total={data.length}
              reordenable={!q}
              moviendo={reordenar.isPending}
              onMover={(d) => mover(indice, d)}
            />
          ))}
          {visibles.length === 0 && (
            <li className="p-6 text-center text-sm text-muted-foreground">Sin opciones</li>
          )}
        </ol>
      )}
    </section>
  )
}

function FilaOpcion({
  opcion,
  indice,
  total,
  reordenable,
  moviendo,
  onMover,
}: {
  opcion: OpcionCatalogo
  indice: number
  total: number
  reordenable: boolean
  moviendo: boolean
  onMover: (delta: -1 | 1) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(opcion.valor)
  const actualizar = useServiceMutation(
    (data: Partial<Pick<OpcionCatalogo, "valor" | "activo">>) =>
      services.catalogos.actualizar(opcion.id, data),
    { invalidar: INVALIDAR_CATALOGOS },
  )

  function guardar(e: React.FormEvent) {
    e.preventDefault()
    if (valor.trim() === opcion.valor) return setEditando(false)
    actualizar.mutate({ valor }, { onSuccess: () => setEditando(false) })
  }

  return (
    <li className={cn("flex items-center gap-2 px-3 py-2", !opcion.activo && "bg-muted/40")}>
      <span className="w-6 text-right text-xs text-muted-foreground tabular-nums">
        {indice + 1}
      </span>
      {editando ? (
        <form onSubmit={guardar} className="flex flex-1 items-center gap-1">
          <Input
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            className="h-7"
            autoFocus
            aria-label="Valor"
            onKeyDown={(e) => e.key === "Escape" && setEditando(false)}
          />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Guardar">
            <Check />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Cancelar"
            onClick={() => {
              setValor(opcion.valor)
              setEditando(false)
            }}
          >
            <X />
          </Button>
        </form>
      ) : (
        <>
          <span className={cn("flex-1 text-sm", !opcion.activo && "text-muted-foreground")}>
            {opcion.valor}
          </span>
          {!opcion.activo && <Badge variant="secondary">Inactiva</Badge>}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Editar ${opcion.valor}`}
            onClick={() => setEditando(true)}
          >
            <Pencil />
          </Button>
        </>
      )}
      <Switch
        checked={opcion.activo}
        disabled={actualizar.isPending}
        onCheckedChange={(activo) => actualizar.mutate({ activo })}
        aria-label={`${opcion.activo ? "Desactivar" : "Activar"} ${opcion.valor}`}
      />
      <div className="flex">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Subir ${opcion.valor}`}
          disabled={!reordenable || moviendo || indice === 0}
          onClick={() => onMover(-1)}
        >
          <ArrowUp />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Bajar ${opcion.valor}`}
          disabled={!reordenable || moviendo || indice === total - 1}
          onClick={() => onMover(1)}
        >
          <ArrowDown />
        </Button>
      </div>
    </li>
  )
}
