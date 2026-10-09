"use client"

import { useQueries } from "@tanstack/react-query"

import { edgeApi } from "@/lib/api"
import { hierarchyQueryKeys } from "@/lib/api/hierarchy"
import { useEdgeVisits, useEdgeYacimientos } from "@/lib/api/hooks"
import type { ArbolYacimiento } from "@/lib/domain/types"

import { aVisitaCliente, contextoDeArboles } from "./visitas-cliente"

/**
 * Visitas del alcance del usuario Cliente (`GET /visits`) con locación y equipo resueltos
 * desde los árboles de sus Yacimientos. Compartido por Calendario y Turnos.
 */
export function useVisitasCliente() {
  const visitas = useEdgeVisits()
  const yacimientos = useEdgeYacimientos()
  const arbolesQ = useQueries({
    queries: (yacimientos.data ?? []).map((yacimiento) => ({
      queryKey: hierarchyQueryKeys.tree(yacimiento.id),
      queryFn: () => edgeApi.hierarchy.tree(yacimiento.id),
    })),
  })
  const arboles = arbolesQ
    .map((q) => q.data)
    .filter((arbol): arbol is ArbolYacimiento => Boolean(arbol))
  const contexto = contextoDeArboles(arboles)
  const lista = (visitas.data ?? []).map((dto) => aVisitaCliente(dto, contexto))

  return {
    visitas: lista,
    arboles,
    cargando: visitas.isPending || yacimientos.isPending || arbolesQ.some((q) => q.isPending),
    error: visitas.error ?? yacimientos.error ?? arbolesQ.find((q) => q.error)?.error ?? null,
    reintentar: () => {
      void visitas.refetch()
      void yacimientos.refetch()
    },
  }
}
