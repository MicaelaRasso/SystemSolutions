// Compila en `.next-e2e` y sirve con `next start`. Lo lanza `webServer` de Playwright.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PUERTO = process.env.E2E_PORT ?? "3100"
const DIST = process.env.NEXT_DIST_DIR
const NEXT = join("node_modules", "next", "dist", "bin", "next")

const abortar = (mensaje) => {
  console.error(`[e2e] ${mensaje}`)
  process.exit(1)
}

if (DIST !== ".next-e2e") abortar(`NEXT_DIST_DIR debe ser .next-e2e y vale "${DIST}"`)
for (const [clave, valor] of Object.entries(process.env)) {
  if (!clave.startsWith("NEXT_PUBLIC_") || !clave.endsWith("URL")) continue
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(valor ?? "")) {
    abortar(`Seguridad: ${clave} no apunta a esta máquina`)
  }
}

/** El build reescribe estos archivos para que apunten a su `distDir`; se los deja como estaban. */
function compilarSinDejarRastro() {
  const copias = ["tsconfig.json", "next-env.d.ts"]
    .filter((archivo) => existsSync(archivo))
    .map((archivo) => [archivo, readFileSync(archivo)])
  const build = spawnSync(process.execPath, [NEXT, "build"], { stdio: "inherit", env: process.env })
  for (const [archivo, contenido] of copias) {
    if (!readFileSync(archivo).equals(contenido)) writeFileSync(archivo, contenido)
  }
  if (build.status !== 0) abortar(`next build terminó con código ${build.status}`)
}

/** Última barrera: si un host remoto de Supabase quedó en el bundle, no se sirve. */
function verificarBundle(directorio) {
  for (const nombre of readdirSync(directorio)) {
    const ruta = join(directorio, nombre)
    if (statSync(ruta).isDirectory()) verificarBundle(ruta)
    else if (
      nombre.endsWith(".js") &&
      /https?:\/\/[a-z0-9-]+\.supabase\.co/.test(readFileSync(ruta, "utf8"))
    ) {
      abortar(`Seguridad: el bundle contiene un host de supabase.co (${ruta})`)
    }
  }
}

if (process.env.E2E_SKIP_BUILD !== "1" || !existsSync(join(DIST, "BUILD_ID"))) {
  compilarSinDejarRastro()
}
verificarBundle(join(DIST, "static"))

const servidor = spawn(process.execPath, [NEXT, "start", "-p", PUERTO], {
  stdio: "inherit",
  env: process.env,
})
servidor.on("exit", (codigo) => process.exit(codigo ?? 0))
for (const senal of ["SIGINT", "SIGTERM"]) process.on(senal, () => servidor.kill())
