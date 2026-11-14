/**
 * `npm run demo:app`: compila y sirve la app en http://localhost:3100 apuntando al stack LOCAL,
 * con el mismo servidor y las mismas barreras que los E2E (`e2e/support/servidor.mjs`): las URL
 * `NEXT_PUBLIC_*` se fijan acá y tienen prioridad sobre `.env.local`, y el bundle no se sirve si
 * contiene un host `supabase.co`. `E2E_SKIP_BUILD=1` reutiliza el build anterior de `.next-e2e`.
 */
import { spawn } from "node:child_process"

import { BASE_URL, SUPABASE_URL, variablesServidorWeb } from "../../e2e/support/entorno"

const env = { ...process.env, ...variablesServidorWeb() }
console.log(
  `App de demo en ${BASE_URL} contra ${SUPABASE_URL} (compila si hace falta; tarda unos minutos).`,
)
const servidor = spawn(process.execPath, ["e2e/support/servidor.mjs"], { stdio: "inherit", env })
servidor.on("exit", (codigo) => process.exit(codigo ?? 0))
for (const senal of ["SIGINT", "SIGTERM"] as const) process.on(senal, () => servidor.kill())
