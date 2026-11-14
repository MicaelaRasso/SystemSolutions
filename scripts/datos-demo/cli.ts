/**
 * `npm run datos:demo`: carga el dataset de demo en la base LOCAL. No lee `.env` ni `.env.local`;
 * el destino sale de `E2E_SUPABASE_URL` o del stack local por defecto (http://127.0.0.1:55321).
 */
import { CONTRASENA } from "../../e2e/support/api"
import { CUENTAS_DEMO, cargarDatosDemo } from "./cargar"
import { DESTINO_POR_DEFECTO } from "./destino"

async function principal() {
  console.log(
    `Datos de demo → ${DESTINO_POR_DEFECTO.url} (base: ${DESTINO_POR_DEFECTO.contenedor})`,
  )
  const inicio = Date.now()
  const informe = await cargarDatosDemo({ log: (mensaje) => console.log(mensaje) })
  console.log("")
  console.table(informe.escenarios)
  console.log(
    `Escenarios nuevos: ${informe.creados.length}; ya existentes: ${informe.existentes.length}. ` +
      `${Math.round((Date.now() - inicio) / 1000)} s.`,
  )
  console.log(`\nCuentas (contraseña ${CONTRASENA}):`)
  for (const [rol, email] of Object.entries(CUENTAS_DEMO))
    console.log(`  ${rol.padEnd(17)} ${email}`)
}

principal().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
