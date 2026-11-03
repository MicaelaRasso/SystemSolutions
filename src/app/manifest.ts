import type { MetadataRoute } from "next"

import { COLOR_FONDO, COLOR_TEMA, NOMBRE_APP } from "@/lib/pwa/identidad"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: NOMBRE_APP,
    short_name: NOMBRE_APP,
    description: "Gestión de calibración de válvulas de seguridad",
    lang: "es",
    start_url: "/",
    display: "standalone",
    theme_color: COLOR_TEMA,
    background_color: COLOR_FONDO,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
