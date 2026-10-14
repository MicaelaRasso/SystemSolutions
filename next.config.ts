import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Reutiliza por 30 s las páginas dinámicas ya visitadas en el cache del router: volver a una
    // sección reciente no pasa por el proxy ni el servidor. Las páginas son envoltorios de
    // componentes cliente; los datos los refresca TanStack Query.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
