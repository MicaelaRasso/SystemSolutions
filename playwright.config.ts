import { defineConfig } from "@playwright/test"

import {
  asegurarUrlLocal,
  BASE_URL,
  SUPABASE_URL,
  variablesServidorWeb,
} from "./e2e/support/entorno"

// Antes de levantar nada: `webServer` arranca antes que `globalSetup`.
asegurarUrlLocal(SUPABASE_URL)

const ARTEFACTOS = "e2e/.artifacts"

export default defineConfig({
  testDir: "./e2e/flujos",
  outputDir: `${ARTEFACTOS}/resultados`,
  globalSetup: "./e2e/global-setup.ts",
  // La plantilla activa y el contador de certificados son globales: una sola corrida a la vez.
  workers: 1,
  fullyParallel: false,
  // Un reintento ocultaría justo lo que se quiere detectar.
  retries: 0,
  forbidOnly: true,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: `${ARTEFACTOS}/resultado.json` }]],
  use: {
    baseURL: BASE_URL,
    channel: "chromium",
    locale: "es-AR",
    timezoneId: "America/Argentina/Buenos_Aires",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // Segunda barrera, por debajo de `route`: alcanza también lo que pide el service worker.
      args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1"],
    },
  },
  webServer: {
    command: "node e2e/support/servidor.mjs",
    url: `${BASE_URL}/offline.html`,
    env: variablesServidorWeb(),
    timeout: 600_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
})
