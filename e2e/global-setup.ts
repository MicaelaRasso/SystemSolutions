import { asegurarContenedorPermitido, asegurarUrlLocal, CONTENEDOR_DB, SUPABASE_URL } from "./support/entorno"
import { prepararSemilla } from "./support/semilla"

/** Aborta antes de tocar datos si el destino no es el stack local, y deja la semilla lista. */
export default async function globalSetup() {
  asegurarUrlLocal(SUPABASE_URL)
  asegurarContenedorPermitido(CONTENEDOR_DB)

  // Sufijo de esta corrida: los datos nuevos no chocan con los de una anterior sobre la misma base.
  const corrida = Date.now().toString(36).slice(-5).toUpperCase()
  process.env.E2E_CORRIDA = corrida
  await prepararSemilla(corrida)
}
