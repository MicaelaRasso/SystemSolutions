import type { ArbolYacimiento, Empresa, Usuario } from "@/lib/domain/types"

import {
  ServiceError,
  type AuthService,
  type CertificadosRepo,
  type EmpresasRepo,
  type EstructuraRepo,
  type Services,
  type UsuariosRepo,
} from "../contracts"
import { catalogos, patrones } from "./catalogos"
import { DEMO_PASSWORD, type MockDb } from "./seed"
import { buscar, normalizar, nuevoId, resetDb, run } from "./store"
import { personas, talleres } from "./talleres"
import { cronograma, tareas } from "./tareas"

const auth: AuthService = {
  login: (email, password) =>
    run((db) => {
      const usuario = db.usuarios.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
      if (!usuario || password !== DEMO_PASSWORD) {
        throw new ServiceError("Email o contraseña incorrectos", "unauthorized")
      }
      if (!usuario.activo) throw new ServiceError("La cuenta está deshabilitada", "unauthorized")
      if (usuario.empresaId) {
        const empresa = db.empresas.find((e) => e.id === usuario.empresaId)
        if (!empresa?.activo)
          throw new ServiceError("La empresa está deshabilitada", "unauthorized")
      }
      return usuario
    }),
}

// ---------------------------------------------------------------------------

function construirArbol(db: MockDb, empresaId: string): ArbolYacimiento[] {
  const certsPorValvula = new Map<string, number>()
  for (const c of db.certificados) {
    certsPorValvula.set(c.valvulaId, (certsPorValvula.get(c.valvulaId) ?? 0) + 1)
  }
  const orden = <T extends { nombre: string }>(a: T, b: T) => a.nombre.localeCompare(b.nombre)
  return db.yacimientos
    .filter((y) => y.empresaId === empresaId)
    .sort(orden)
    .map((y) => ({
      ...y,
      plantas: db.plantas
        .filter((p) => p.yacimientoId === y.id)
        .sort(orden)
        .map((p) => ({
          ...p,
          equipos: db.equipos
            .filter((e) => e.plantaId === p.id)
            .sort(orden)
            .map((e) => ({
              ...e,
              valvulas: db.valvulas
                .filter((v) => v.equipoId === e.id)
                .sort((a, b) => a.tag.localeCompare(b.tag))
                .map((v) => ({ ...v, certificados: certsPorValvula.get(v.id) ?? 0 })),
            })),
        })),
    }))
}

function contarValvulas(db: MockDb, empresaId: string) {
  const yac = new Set(db.yacimientos.filter((y) => y.empresaId === empresaId).map((y) => y.id))
  const pla = new Set(db.plantas.filter((p) => yac.has(p.yacimientoId)).map((p) => p.id))
  const equ = new Set(db.equipos.filter((e) => pla.has(e.plantaId)).map((e) => e.id))
  return db.valvulas.filter((v) => equ.has(v.equipoId)).length
}

async function leerLogo(archivo: File): Promise<string> {
  const MAX = 320
  const bitmap = await createImageBitmap(archivo)
  const escala = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * escala)
  canvas.height = Math.round(bitmap.height * escala)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/png")
}

const empresas: EmpresasRepo = {
  list: (filtro = {}) =>
    run((db) => {
      const q = normalizar(filtro.q ?? "")
      return db.empresas
        .filter((e) => filtro.incluirInactivas !== false || e.activo)
        .filter(
          (e) =>
            !q ||
            normalizar(e.razonSocial).includes(q) ||
            e.cuit.includes(q) ||
            normalizar(e.contacto).includes(q),
        )
        .sort((a, b) => a.razonSocial.localeCompare(b.razonSocial))
        .map((e) => ({
          ...e,
          yacimientos: db.yacimientos.filter((y) => y.empresaId === e.id).length,
          valvulas: contarValvulas(db, e.id),
          usuarios: db.usuarios.filter((u) => u.empresaId === e.id).length,
        }))
    }),
  get: (id) => run((db) => buscar(db.empresas, id, "Cliente")),
  create: (data) =>
    run(
      (db) => {
        if (db.empresas.some((e) => e.cuit === data.cuit)) {
          throw new ServiceError("Ya existe un cliente con ese CUIT", "conflict")
        }
        const empresa: Empresa = { ...data, id: nuevoId("emp"), creadoEn: new Date().toISOString() }
        db.empresas.push(empresa)
        return empresa
      },
      { escribe: true },
    ),
  update: (id, data) =>
    run(
      (db) => {
        if (data.cuit && db.empresas.some((e) => e.cuit === data.cuit && e.id !== id)) {
          throw new ServiceError("Ya existe un cliente con ese CUIT", "conflict")
        }
        return Object.assign(buscar(db.empresas, id, "Cliente"), data)
      },
      { escribe: true },
    ),
  setLogo: async (id, archivo) => {
    const logoUrl = archivo ? await leerLogo(archivo) : undefined
    return run((db) => Object.assign(buscar(db.empresas, id, "Cliente"), { logoUrl }), {
      escribe: true,
    })
  },
}

// ---------------------------------------------------------------------------

function sinHijos(hay: boolean, mensaje: string) {
  if (hay) throw new ServiceError(mensaje, "conflict")
}

const estructura: EstructuraRepo = {
  arbol: (empresaId) => run((db) => construirArbol(db, empresaId)),

  createYacimiento: (data) =>
    run(
      (db) => {
        const item = { ...data, id: nuevoId("yac") }
        db.yacimientos.push(item)
        return item
      },
      { escribe: true },
    ),
  updateYacimiento: (id, data) =>
    run((db) => Object.assign(buscar(db.yacimientos, id, "Yacimiento"), data), { escribe: true }),
  deleteYacimiento: (id) =>
    run(
      (db) => {
        sinHijos(
          db.plantas.some((p) => p.yacimientoId === id),
          "El yacimiento tiene plantas cargadas. Eliminalas primero.",
        )
        db.yacimientos = db.yacimientos.filter((x) => x.id !== id)
        db.accesos = db.accesos.filter((a) => !(a.nivel === "yacimiento" && a.refId === id))
      },
      { escribe: true },
    ),

  createPlanta: (data) =>
    run(
      (db) => {
        const item = { ...data, id: nuevoId("pla") }
        db.plantas.push(item)
        return item
      },
      { escribe: true },
    ),
  updatePlanta: (id, data) =>
    run((db) => Object.assign(buscar(db.plantas, id, "Planta"), data), { escribe: true }),
  deletePlanta: (id) =>
    run(
      (db) => {
        sinHijos(
          db.equipos.some((e) => e.plantaId === id),
          "La planta tiene equipos cargados. Eliminalos primero.",
        )
        db.plantas = db.plantas.filter((x) => x.id !== id)
        db.accesos = db.accesos.filter((a) => !(a.nivel === "planta" && a.refId === id))
      },
      { escribe: true },
    ),

  createEquipo: (data) =>
    run(
      (db) => {
        const item = { ...data, id: nuevoId("equ") }
        db.equipos.push(item)
        return item
      },
      { escribe: true },
    ),
  updateEquipo: (id, data) =>
    run((db) => Object.assign(buscar(db.equipos, id, "Equipo"), data), { escribe: true }),
  deleteEquipo: (id) =>
    run(
      (db) => {
        sinHijos(
          db.valvulas.some((v) => v.equipoId === id),
          "El equipo tiene válvulas cargadas. Eliminalas primero.",
        )
        sinHijos(
          db.tareas.some((t) => t.equipoId === id),
          "El equipo tiene tareas registradas y no puede eliminarse.",
        )
        db.equipos = db.equipos.filter((x) => x.id !== id)
        db.accesos = db.accesos.filter((a) => !(a.nivel === "equipo" && a.refId === id))
      },
      { escribe: true },
    ),

  getValvula: (id) => run((db) => buscar(db.valvulas, id, "Válvula")),
  createValvula: (data) =>
    run(
      (db) => {
        const item = { ...data, id: nuevoId("val") }
        db.valvulas.push(item)
        return item
      },
      { escribe: true },
    ),
  updateValvula: (id, data) =>
    run((db) => Object.assign(buscar(db.valvulas, id, "Válvula"), data), { escribe: true }),
  deleteValvula: (id) =>
    run(
      (db) => {
        // RN-03: el histórico de certificados se conserva siempre.
        sinHijos(
          db.certificados.some((c) => c.valvulaId === id),
          "La válvula tiene certificados emitidos y no puede eliminarse.",
        )
        db.valvulas = db.valvulas.filter((x) => x.id !== id)
      },
      { escribe: true },
    ),
}

// ---------------------------------------------------------------------------

const usuarios: UsuariosRepo = {
  list: (filtro = {}) =>
    run((db) =>
      db.usuarios
        .filter((u) => !filtro.rol || u.rol === filtro.rol)
        .filter((u) => !filtro.empresaId || u.empresaId === filtro.empresaId)
        .sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`)),
    ),
  get: (id) => run((db) => buscar(db.usuarios, id, "Usuario")),
  create: (data) =>
    run(
      (db) => {
        const email = data.email.trim().toLowerCase()
        if (db.usuarios.some((u) => u.email.toLowerCase() === email)) {
          throw new ServiceError("Ya existe un usuario con ese email", "conflict")
        }
        const usuario: Usuario = {
          ...data,
          email,
          id: nuevoId("usr"),
          creadoEn: new Date().toISOString(),
        }
        db.usuarios.push(usuario)
        return usuario
      },
      { escribe: true },
    ),
  update: (id, data) =>
    run(
      (db) => {
        const email = data.email?.trim().toLowerCase()
        if (email && db.usuarios.some((u) => u.email.toLowerCase() === email && u.id !== id)) {
          throw new ServiceError("Ya existe un usuario con ese email", "conflict")
        }
        return Object.assign(buscar(db.usuarios, id, "Usuario"), data, email ? { email } : {})
      },
      { escribe: true },
    ),
  delete: (id) =>
    run(
      (db) => {
        buscar(db.usuarios, id, "Usuario")
        db.usuarios = db.usuarios.filter((u) => u.id !== id)
        db.accesos = db.accesos.filter((a) => a.usuarioId !== id)
      },
      { escribe: true },
    ),
  getAccesos: (usuarioId) => run((db) => db.accesos.filter((a) => a.usuarioId === usuarioId)),
  setAccesos: (usuarioId, accesos) =>
    run(
      (db) => {
        db.accesos = [
          ...db.accesos.filter((a) => a.usuarioId !== usuarioId),
          ...accesos.map((a) => ({ ...a, usuarioId })),
        ]
      },
      { escribe: true },
    ),
}

const certificados: CertificadosRepo = {
  listPorValvula: (valvulaId) =>
    run((db) =>
      db.certificados
        .filter((c) => c.valvulaId === valvulaId)
        .sort((a, b) => b.fechaEjecucion.localeCompare(a.fechaEjecucion)),
    ),
}

export const mockServices: Services = {
  auth,
  empresas,
  estructura,
  usuarios,
  talleres,
  personas,
  catalogos,
  patrones,
  tareas,
  cronograma,
  certificados,
  demo: { reset: async () => resetDb() },
}
