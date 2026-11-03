import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const DIRECTORIO = join("e2e", ".artifacts", "estado")

const ruta = (clave: string) => {
  const corrida = process.env.E2E_CORRIDA
  if (!corrida) throw new Error("Falta E2E_CORRIDA: la define e2e/global-setup.ts")
  return join(DIRECTORIO, `${corrida}-${clave}.json`)
}

/**
 * Lo que una prueba deja para las siguientes del mismo flujo. Va a disco porque Playwright
 * reinicia el worker después de una falla, y una falla no debe obligar a repetir el flujo.
 */
export function guardarEstado(clave: string, valor: unknown) {
  mkdirSync(DIRECTORIO, { recursive: true })
  writeFileSync(ruta(clave), JSON.stringify(valor, null, 2))
}

export function leerEstado<T>(clave: string): T {
  const archivo = ruta(clave)
  if (!existsSync(archivo)) {
    throw new Error(`Precondición no cumplida: la prueba que deja "${clave}" no terminó`)
  }
  return JSON.parse(readFileSync(archivo, "utf8")) as T
}
