import { z } from "zod"

import type { Empresa, ID, ListaCatalogo, NominaJornada, OpcionCatalogo, Patron, Persona, Usuario } from "../domain/types"
import type { TallerConCuenta } from "../services/contracts"
import type { EdgeAccessClient } from "../services/edge"
import {
  accountDtoSchema,
  catalogOptionDtoSchema,
  clientDtoSchema,
  personDtoSchema,
  staffingDtoSchema,
  testStandardDtoSchema,
  workshopDtoSchema,
} from "./contracts"

const accessDtoSchema = z.object({
  usuario_id: z.string(),
  nivel: z.enum(["yacimiento", "planta", "equipo"]),
  ref_id: z.string(),
})

const json = (value: unknown) => JSON.stringify(value)

const roleMap: Record<z.infer<typeof accountDtoSchema>["rol"], Usuario["rol"]> = {
  cliente: "cliente",
  taller_movil: "taller",
  administrador_regular: "admin",
  super_administrador: "superadmin",
}

const toEmpresa = (dto: z.infer<typeof clientDtoSchema>): Empresa => ({
  id: dto.id,
  razonSocial: dto.razon_social,
  cuit: dto.cuit,
  contacto: dto.contacto,
  telefono: dto.telefono,
  email: dto.email,
  direccion: dto.direccion,
  logoUrl: typeof dto.logo_url === "string" ? dto.logo_url : undefined,
  avisoVencimiento: dto.aviso_vencimiento,
  activo: dto.activo,
  creadoEn: dto.creado_en,
})

const toUsuario = (dto: z.infer<typeof accountDtoSchema>): Usuario => ({
  id: dto.id,
  email: dto.email,
  nombre: dto.nombre,
  apellido: dto.apellido,
  rol: roleMap[dto.rol],
  empresaId: dto.rol === "cliente" ? undefined : undefined,
  activo: dto.activo,
  creadoEn: dto.creado_en,
})

const toCatalogOption = (dto: z.infer<typeof catalogOptionDtoSchema>): OpcionCatalogo => ({
  id: dto.id,
  lista: dto.lista as ListaCatalogo,
  valor: dto.valor,
  orden: dto.orden,
  activo: dto.activo,
})

export function createAdminApi(edge: EdgeAccessClient) {
  return {
    clients: {
      async list(filter: { q?: string; incluirInactivas?: boolean } = {}) {
        const query = new URLSearchParams()
        if (filter.q) query.set("q", filter.q)
        query.set("include_inactive", String(filter.incluirInactivas !== false))
        const rows = await edge.request(`clients?${query}`, clientDtoSchema.array())
        return rows.map((row) => ({ ...toEmpresa(row), yacimientos: row.yacimientos, valvulas: row.valvulas, usuarios: row.usuarios }))
      },
      async get(id: ID) {
        return toEmpresa(await edge.request(`clients/${id}`, clientDtoSchema))
      },
      async create(data: Omit<Empresa, "id" | "creadoEn">) {
        return toEmpresa(await edge.request("clients", clientDtoSchema, {
          method: "POST",
          body: json({ razon_social: data.razonSocial, cuit: data.cuit, contacto: data.contacto, telefono: data.telefono, email: data.email, direccion: data.direccion, aviso_vencimiento: data.avisoVencimiento, activo: data.activo }),
        }))
      },
      async update(id: ID, data: Partial<Omit<Empresa, "id">>) {
        const current = await this.get(id)
        return toEmpresa(await edge.request(`clients/${id}`, clientDtoSchema, {
          method: "PATCH",
          body: json({ razon_social: data.razonSocial ?? current.razonSocial, cuit: data.cuit ?? current.cuit, contacto: data.contacto ?? current.contacto, telefono: data.telefono ?? current.telefono, email: data.email ?? current.email, direccion: data.direccion ?? current.direccion, aviso_vencimiento: data.avisoVencimiento ?? current.avisoVencimiento, activo: data.activo ?? current.activo }),
        }))
      },
      async setLogo(id: ID, file: File | null) {
        if (!file)
          return toEmpresa(
            await edge.request(`clients/${id}/logo`, clientDtoSchema, { method: "DELETE" }),
          )
        const form = new FormData()
        form.set("file", file)
        return toEmpresa(await edge.request(`clients/${id}/logo`, clientDtoSchema, { method: "PUT", body: form }))
      },
    },
    accounts: {
      async list(clientId: ID) {
        const rows = await edge.request(`accounts?client_id=${encodeURIComponent(clientId)}`, accountDtoSchema.array())
        return rows.map((row) => ({ ...toUsuario(row), empresaId: clientId }))
      },
      async create(clientId: ID, data: { nombre: string; apellido: string; email: string; activo: boolean }) {
        const row = await edge.request("accounts", accountDtoSchema, { method: "POST", body: json({ client_id: clientId, ...data }) })
        return { ...toUsuario(row), empresaId: clientId }
      },
      async update(id: ID, data: Partial<{ nombre: string; apellido: string; email: string; activo: boolean }>) {
        return toUsuario(await edge.request(`accounts/${id}`, accountDtoSchema, { method: "PATCH", body: json(data) }))
      },
      remove: (id: ID) => edge.request(`accounts/${id}`, z.null(), { method: "DELETE" }).then(() => undefined),
      access: (id: ID) => edge.request(`accounts/${id}/access-scopes`, accessDtoSchema.array()),
      setAccess: (id: ID, scopes: { nivel: "yacimiento" | "planta" | "equipo"; refId: ID }[]) =>
        edge.request(`accounts/${id}/access-scopes`, accessDtoSchema.array(), { method: "PUT", body: json({ scopes: scopes.map((scope) => ({ nivel: scope.nivel, ref_id: scope.refId })) }) }),
    },
    workshops: {
      list: async () => (await edge.request("mobile-workshops", workshopDtoSchema.array())).map((row): TallerConCuenta => ({ id: row.id, nombre: row.nombre, color: row.color, activo: row.activo, usuarioId: row.usuario_id ?? "", email: row.email })),
      create: async (data: { nombre: string; color: string; email: string }) => {
        const row = await edge.request("mobile-workshops", workshopDtoSchema, { method: "POST", body: json(data) })
        return { id: row.id, nombre: row.nombre, color: row.color, activo: row.activo, usuarioId: row.usuario_id ?? "", email: row.email }
      },
      update: async (id: ID, data: Partial<{ nombre: string; color: string; email: string; activo: boolean }>) => {
        const current = (await edge.request("mobile-workshops", workshopDtoSchema.array())).find((row) => row.id === id)
        const row = await edge.request(`mobile-workshops/${id}`, workshopDtoSchema, { method: "PATCH", body: json({ nombre: data.nombre ?? current?.nombre, color: data.color ?? current?.color, email: data.email ?? current?.email, activo: data.activo ?? current?.activo }) })
        return { id: row.id, nombre: row.nombre, color: row.color, activo: row.activo, usuarioId: row.usuario_id ?? "", email: row.email }
      },
    },
    people: {
      list: async () => edge.request("technicians", personDtoSchema.array()),
      create: (data: Omit<Persona, "id">) => edge.request("technicians", personDtoSchema, { method: "POST", body: json(data) }),
      update: (id: ID, data: Partial<Omit<Persona, "id">>) => edge.request(`technicians/${id}`, personDtoSchema, { method: "PATCH", body: json(data) }),
    },
    catalogs: {
      options: async (list: ListaCatalogo) => (await edge.request(`catalogs/${list}/options`, catalogOptionDtoSchema.array())).map(toCatalogOption),
      list: async (list: ListaCatalogo) => (await edge.request(`catalogs/${list}`, catalogOptionDtoSchema.array())).map(toCatalogOption),
      summary: async () => {
        const rows = await edge.request("catalogs/summary", z.object({ lista: z.string(), total: z.number(), activas: z.number() }).array())
        return Object.fromEntries(rows.map((row) => [row.lista, { total: row.total, activas: row.activas }])) as Record<ListaCatalogo, { total: number; activas: number }>
      },
      create: async (list: ListaCatalogo, value: string) => toCatalogOption(await edge.request(`catalogs/${list}/options`, catalogOptionDtoSchema, { method: "POST", body: json({ valor: value }) })),
      update: async (id: ID, data: Partial<Pick<OpcionCatalogo, "valor" | "activo">>) => toCatalogOption(await edge.request(`catalog-options/${id}`, catalogOptionDtoSchema, { method: "PATCH", body: json(data) })),
      reorder: (list: ListaCatalogo, ids: ID[]) => edge.request(`catalogs/${list}/order`, z.null(), { method: "PUT", body: json({ ids }) }).then(() => undefined),
    },
    standards: {
      list: async () => (await edge.request("test-standards", testStandardDtoSchema.array())).map((row): Patron => ({ id: row.id, nombre: row.nombre, nroSerie: row.nro_serie, vencimiento: row.vencimiento, activo: row.activo })),
      create: async (data: Omit<Patron, "id">) => {
        const row = await edge.request("test-standards", testStandardDtoSchema, { method: "POST", body: json({ nombre: data.nombre, nro_serie: data.nroSerie, vencimiento: data.vencimiento, activo: data.activo }) })
        return { id: row.id, nombre: row.nombre, nroSerie: row.nro_serie, vencimiento: row.vencimiento, activo: row.activo }
      },
      update: async (id: ID, data: Partial<Omit<Patron, "id">>) => {
        const row = await edge.request(`test-standards/${id}`, testStandardDtoSchema, { method: "PATCH", body: json({ nombre: data.nombre, nro_serie: data.nroSerie, vencimiento: data.vencimiento, activo: data.activo }) })
        return { id: row.id, nombre: row.nombre, nroSerie: row.nro_serie, vencimiento: row.vencimiento, activo: row.activo }
      },
    },
    staffing: {
      list: async (from: string, to: string): Promise<NominaJornada[]> => (await edge.request(`staffing?from=${from}&to=${to}`, staffingDtoSchema.array())).map((row) => ({ tallerId: row.taller_id, fecha: row.fecha, personaIds: row.persona_ids })),
      set: (workshopId: ID, date: string, personIds: ID[]) => edge.request(`staffing/${workshopId}/${date}`, z.unknown(), { method: "PUT", body: json({ persona_ids: personIds }) }).then(() => undefined),
      copyPreviousWeek: (monday: string) => edge.request("staffing/copy-previous-week", z.number(), { method: "POST", body: json({ lunes: monday }) }),
    },
  }
}

export type AdminApi = ReturnType<typeof createAdminApi>
