/**
 * "Base de datos" del modo demo: vive en localStorage del navegador.
 * Cada operación simula latencia de red para que la UI muestre estados de carga reales.
 */

import { ServiceError } from "../contracts"
import { crearSeed, MOCK_DB_VERSION, type MockDb } from "./seed"

const STORAGE_KEY = "ss-mock-db"
const LATENCIA_MIN_MS = 150
const LATENCIA_MAX_MS = 450
/** Probabilidad (0–1) de error simulado de red, para probar estados de error. */
const TASA_ERROR = Number(process.env.NEXT_PUBLIC_MOCK_ERROR_RATE ?? 0)

let cache: MockDb | null = null

function cargar(): MockDb {
  if (cache) return cache
  if (typeof window === "undefined") {
    cache = crearSeed()
    return cache
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MockDb
      if (parsed.version === MOCK_DB_VERSION) {
        cache = parsed
        return cache
      }
    }
  } catch {
    // Datos corruptos o storage bloqueado: se regenera la semilla.
  }
  cache = crearSeed()
  guardar()
  return cache
}

function guardar() {
  if (typeof window === "undefined" || !cache) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Cuota excedida o storage bloqueado: los cambios quedan solo en memoria.
  }
}

export function resetDb() {
  cache = crearSeed()
  guardar()
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Ejecuta una operación contra la db simulando red.
 * Devuelve una copia para que la UI nunca mute el estado interno.
 */
export async function run<T>(
  op: (db: MockDb) => T,
  opciones: { escribe?: boolean } = {},
): Promise<T> {
  await esperar(LATENCIA_MIN_MS + Math.random() * (LATENCIA_MAX_MS - LATENCIA_MIN_MS))
  if (TASA_ERROR > 0 && Math.random() < TASA_ERROR) {
    throw new ServiceError("Error de conexión simulado", "network")
  }
  const db = cargar()
  const resultado = op(db)
  if (opciones.escribe) guardar()
  return resultado === undefined ? resultado : structuredClone(resultado)
}

export function nuevoId(prefijo: string) {
  return `${prefijo}-${crypto.randomUUID().slice(0, 8)}`
}

export function buscar<T extends { id: string }>(lista: T[], id: string, entidad: string): T {
  const item = lista.find((x) => x.id === id)
  if (!item) throw new ServiceError(`${entidad} no encontrado`, "not_found")
  return item
}

/** Minúsculas y sin tildes, para búsquedas. */
export const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()

/** Lee un archivo como data URL (en producción se sube a Supabase Storage). */
export function leerComoDataUrl(archivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(archivo)
  })
}
