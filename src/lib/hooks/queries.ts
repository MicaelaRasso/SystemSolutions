"use client"

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query"
import { toast } from "sonner"

import type { ID, ListaCatalogo, Rol } from "@/lib/domain/types"
import { services, type FiltroTareas } from "@/lib/services"

export const qk = {
  empresas: (filtro?: object) => ["empresas", filtro ?? {}] as const,
  empresa: (id: ID) => ["empresa", id] as const,
  arbol: (empresaId: ID) => ["arbol", empresaId] as const,
  valvula: (id: ID) => ["valvula", id] as const,
  usuarios: (filtro?: object) => ["usuarios", filtro ?? {}] as const,
  accesos: (usuarioId: ID) => ["accesos", usuarioId] as const,
  certificadosValvula: (valvulaId: ID) => ["certificados", "valvula", valvulaId] as const,
  catalogo: (lista: ListaCatalogo) => ["catalogo", lista] as const,
  catalogoAdmin: (lista: ListaCatalogo) => ["catalogo-admin", lista] as const,
  catalogoResumen: () => ["catalogo-admin", "resumen"] as const,
  patrones: () => ["patrones"] as const,
  talleres: () => ["talleres"] as const,
  personas: () => ["personas"] as const,
  tareas: (filtro?: FiltroTareas) => ["tareas", filtro ?? {}] as const,
  tarea: (id: ID) => ["tarea", id] as const,
  nominas: (desde: string, hasta: string) => ["nominas", desde, hasta] as const,
}

/** Prefijos a invalidar tras modificar un catálogo (formularios y administración). */
export const INVALIDAR_CATALOGOS = [["catalogo"], ["catalogo-admin"]]
/** Prefijos a invalidar tras modificar tareas. */
export const INVALIDAR_TAREAS = [["tareas"], ["tarea"]]

export function mensajeError(error: unknown) {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado"
}

/**
 * Mutación con toast de éxito/error e invalidación de queries.
 * `invalidar` recibe prefijos: ["empresas"] invalida todas las listas de empresas.
 */
export function useServiceMutation<TVars, TResult>(
  fn: (vars: TVars) => Promise<TResult>,
  opciones: { exito?: string; invalidar?: QueryKey[] } = {},
) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        (opciones.invalidar ?? []).map((k) => qc.invalidateQueries({ queryKey: k })),
      )
      if (opciones.exito) toast.success(opciones.exito)
    },
    onError: (error) => toast.error(mensajeError(error)),
  })
}

export const useEmpresas = (filtro: { q?: string; incluirInactivas?: boolean } = {}) =>
  useQuery({ queryKey: qk.empresas(filtro), queryFn: () => services.empresas.list(filtro) })

export const useEmpresa = (id: ID) =>
  useQuery({ queryKey: qk.empresa(id), queryFn: () => services.empresas.get(id) })

export const useArbol = (empresaId: ID) =>
  useQuery({
    queryKey: qk.arbol(empresaId),
    queryFn: () => services.estructura.arbol(empresaId),
    enabled: !!empresaId,
  })

export const useUsuarios = (filtro: { rol?: Rol; empresaId?: ID } = {}) =>
  useQuery({ queryKey: qk.usuarios(filtro), queryFn: () => services.usuarios.list(filtro) })

export const useAccesos = (usuarioId: ID | undefined) =>
  useQuery({
    queryKey: qk.accesos(usuarioId ?? ""),
    queryFn: () => services.usuarios.getAccesos(usuarioId!),
    enabled: !!usuarioId,
  })

export const useCertificadosValvula = (valvulaId: ID | undefined) =>
  useQuery({
    queryKey: qk.certificadosValvula(valvulaId ?? ""),
    queryFn: () => services.certificados.listPorValvula(valvulaId!),
    enabled: !!valvulaId,
  })

export const useCatalogo = (lista: ListaCatalogo) =>
  useQuery({
    queryKey: qk.catalogo(lista),
    queryFn: () => services.catalogos.opciones(lista),
    staleTime: 5 * 60_000,
  })

export const useCatalogoAdmin = (lista: ListaCatalogo) =>
  useQuery({ queryKey: qk.catalogoAdmin(lista), queryFn: () => services.catalogos.listar(lista) })

export const useCatalogoResumen = () =>
  useQuery({ queryKey: qk.catalogoResumen(), queryFn: () => services.catalogos.resumen() })

export const usePatrones = () =>
  useQuery({ queryKey: qk.patrones(), queryFn: () => services.patrones.list() })

export const useTalleres = () =>
  useQuery({ queryKey: qk.talleres(), queryFn: () => services.talleres.list() })

export const usePersonas = () =>
  useQuery({ queryKey: qk.personas(), queryFn: () => services.personas.list() })

export const useTareas = (filtro: FiltroTareas = {}) =>
  useQuery({
    queryKey: qk.tareas(filtro),
    queryFn: () => services.tareas.list(filtro),
    placeholderData: (prev) => prev,
  })

export const useTarea = (id: ID) =>
  useQuery({ queryKey: qk.tarea(id), queryFn: () => services.tareas.get(id) })

export const useNominas = (desde: string, hasta: string) =>
  useQuery({
    queryKey: qk.nominas(desde, hasta),
    queryFn: () => services.cronograma.nominas(desde, hasta),
    placeholderData: (prev) => prev,
  })
