import {
  asegurarContenedorPermitido,
  asegurarUrlLocal,
  CONTENEDOR_DB,
  SUPABASE_URL,
} from "../../e2e/support/entorno"

export type Destino = { url: string; contenedor: string }

/**
 * Los datos de demo van SOLO a la base local (decisión del usuario, 2026-11-13). El destino sale
 * de `E2E_SUPABASE_URL` / `E2E_DB_CONTAINER` o de los valores del stack local; nunca de
 * `.env` ni `.env.local`, que pueden tener las credenciales de producción.
 */
export const DESTINO_POR_DEFECTO: Destino = { url: SUPABASE_URL, contenedor: CONTENEDOR_DB }

/** Corta antes de cualquier pedido si la URL o el contenedor no son los de esta máquina. */
export function asegurarDestinoLocal(destino: Destino = DESTINO_POR_DEFECTO) {
  asegurarUrlLocal(destino.url, "E2E_SUPABASE_URL (destino de los datos de demo)")
  asegurarContenedorPermitido(destino.contenedor)
  return destino
}
