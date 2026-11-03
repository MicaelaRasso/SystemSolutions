import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Las pruebas E2E compilan aparte: NEXT_PUBLIC_* queda fijado en el build y no debe pisar `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    // Reutiliza por 30 s las páginas dinámicas ya visitadas en el cache del router: volver a una
    // sección reciente no pasa por el proxy ni el servidor. Las páginas son envoltorios de
    // componentes cliente; los datos los refresca TanStack Query.
    staleTimes: { dynamic: 30 },
  },
  // Cabeceras recomendadas por la guía de PWA: el navegador siempre revisa si hay un worker nuevo.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
