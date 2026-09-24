import type { ListaCatalogo, OpcionCatalogo, Patron } from "@/lib/domain/types"

import { ServiceError, type CatalogosRepo, type PatronesRepo } from "../contracts"
import type { MockDb } from "./seed"
import { buscar, normalizar, nuevoId, run } from "./store"

const deLista = (db: MockDb, lista: ListaCatalogo) =>
  db.catalogo.filter((o) => o.lista === lista).sort((a, b) => a.orden - b.orden)

function validarUnico(db: MockDb, lista: ListaCatalogo, valor: string, exceptoId?: string) {
  const v = normalizar(valor.trim())
  if (!v) throw new ServiceError("El valor no puede estar vacío", "invalid")
  if (deLista(db, lista).some((o) => o.id !== exceptoId && normalizar(o.valor) === v)) {
    throw new ServiceError(`"${valor.trim()}" ya existe en la lista`, "conflict")
  }
}

export const catalogos: CatalogosRepo = {
  opciones: (lista) => run((db) => deLista(db, lista).filter((o) => o.activo)),
  listar: (lista) => run((db) => deLista(db, lista)),
  resumen: () =>
    run((db) => {
      const r = {} as Record<ListaCatalogo, { total: number; activas: number }>
      for (const o of db.catalogo) {
        r[o.lista] ??= { total: 0, activas: 0 }
        r[o.lista].total++
        if (o.activo) r[o.lista].activas++
      }
      return r
    }),
  crear: (lista, valor) =>
    run(
      (db) => {
        validarUnico(db, lista, valor)
        const opcion: OpcionCatalogo = {
          id: nuevoId(`cat-${lista}`),
          lista,
          valor: valor.trim(),
          orden: Math.max(-1, ...deLista(db, lista).map((o) => o.orden)) + 1,
          activo: true,
        }
        db.catalogo.push(opcion)
        return opcion
      },
      { escribe: true },
    ),
  actualizar: (id, data) =>
    run(
      (db) => {
        const opcion = buscar(db.catalogo, id, "Opción")
        if (data.valor !== undefined) {
          validarUnico(db, opcion.lista, data.valor, id)
          data = { ...data, valor: data.valor.trim() }
        }
        return Object.assign(opcion, data)
      },
      { escribe: true },
    ),
  reordenar: (lista, ids) =>
    run(
      (db) => {
        ids.forEach((id, orden) => {
          const opcion = buscar(db.catalogo, id, "Opción")
          if (opcion.lista !== lista) throw new ServiceError("Opción de otra lista", "invalid")
          opcion.orden = orden
        })
      },
      { escribe: true },
    ),
}

function validarPatron(db: MockDb, data: Partial<Patron>, exceptoId?: string) {
  if (
    data.nroSerie &&
    db.patrones.some(
      (p) =>
        p.id !== exceptoId &&
        normalizar(p.nroSerie) === normalizar(data.nroSerie!) &&
        normalizar(p.nombre) === normalizar(data.nombre ?? p.nombre),
    )
  ) {
    throw new ServiceError("Ya existe un patrón con ese nombre y N° de serie", "conflict")
  }
}

export const patrones: PatronesRepo = {
  list: () =>
    run((db) =>
      [...db.patrones].sort(
        (a, b) => a.nombre.localeCompare(b.nombre) || a.nroSerie.localeCompare(b.nroSerie),
      ),
    ),
  create: (data) =>
    run(
      (db) => {
        validarPatron(db, data)
        const patron = { ...data, id: nuevoId("pat") }
        db.patrones.push(patron)
        return patron
      },
      { escribe: true },
    ),
  update: (id, data) =>
    run(
      (db) => {
        const patron = buscar(db.patrones, id, "Patrón")
        validarPatron(db, { ...patron, ...data }, id)
        return Object.assign(patron, data)
      },
      { escribe: true },
    ),
}
