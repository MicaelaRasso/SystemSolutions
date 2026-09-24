import type { Persona, Taller } from "@/lib/domain/types"

import {
  ServiceError,
  type PersonasRepo,
  type TallerConCuenta,
  type TalleresRepo,
} from "../contracts"
import type { MockDb } from "./seed"
import { buscar, nuevoId, run } from "./store"

function conCuenta(db: MockDb, t: Taller): TallerConCuenta {
  const cuenta = db.usuarios.find((u) => u.rol === "taller" && u.tallerId === t.id)
  return { ...t, usuarioId: cuenta?.id ?? "", email: cuenta?.email ?? "" }
}

function validarEmail(db: MockDb, email: string, exceptoUsuarioId?: string) {
  const e = email.trim().toLowerCase()
  if (db.usuarios.some((u) => u.email.toLowerCase() === e && u.id !== exceptoUsuarioId)) {
    throw new ServiceError("Ya existe una cuenta con ese email", "conflict")
  }
  return e
}

export const talleres: TalleresRepo = {
  list: () =>
    run((db) =>
      [...db.talleres]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }))
        .map((t) => conCuenta(db, t)),
    ),
  create: ({ nombre, color, email }) =>
    run(
      (db) => {
        const mail = validarEmail(db, email)
        const taller: Taller = { id: nuevoId("tal"), nombre: nombre.trim(), color, activo: true }
        db.talleres.push(taller)
        db.usuarios.push({
          id: nuevoId("usr"),
          email: mail,
          nombre: taller.nombre,
          apellido: "",
          rol: "taller",
          tallerId: taller.id,
          activo: true,
          creadoEn: new Date().toISOString(),
        })
        return conCuenta(db, taller)
      },
      { escribe: true },
    ),
  update: (id, { email, ...data }) =>
    run(
      (db) => {
        const taller = buscar(db.talleres, id, "Taller")
        const cuenta = db.usuarios.find((u) => u.rol === "taller" && u.tallerId === id)
        Object.assign(taller, data, data.nombre ? { nombre: data.nombre.trim() } : {})
        if (cuenta) {
          if (email) cuenta.email = validarEmail(db, email, cuenta.id)
          cuenta.nombre = taller.nombre
          cuenta.activo = taller.activo
        }
        return conCuenta(db, taller)
      },
      { escribe: true },
    ),
}

function validarDni(db: MockDb, dni: string | undefined, exceptoId?: string) {
  if (dni && db.personas.some((p) => p.dni === dni && p.id !== exceptoId)) {
    throw new ServiceError("Ya existe una persona con ese DNI", "conflict")
  }
}

export const personas: PersonasRepo = {
  list: () =>
    run((db) =>
      [...db.personas].sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`),
      ),
    ),
  create: (data) =>
    run(
      (db) => {
        validarDni(db, data.dni)
        const persona: Persona = { ...data, id: nuevoId("per") }
        db.personas.push(persona)
        return persona
      },
      { escribe: true },
    ),
  update: (id, data) =>
    run(
      (db) => {
        validarDni(db, data.dni, id)
        return Object.assign(buscar(db.personas, id, "Persona"), data)
      },
      { escribe: true },
    ),
}
