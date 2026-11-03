import { resolve } from "node:path"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd(), "src") },
  },
  test: {
    // Los E2E corren con Playwright (`npm run test:e2e`).
    exclude: [...configDefaults.exclude, "e2e/**", ".next-e2e/**"],
  },
})
