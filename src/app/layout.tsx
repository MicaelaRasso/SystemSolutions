import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import { Providers } from "@/components/providers"
import { COLOR_TEMA, NOMBRE_APP } from "@/lib/pwa/identidad"

import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "System Solutions",
    template: "%s · System Solutions",
  },
  description: "Gestión de calibración de válvulas de seguridad",
  applicationName: NOMBRE_APP,
  appleWebApp: { capable: true, title: NOMBRE_APP },
  icons: { apple: "/icons/apple-touch-icon.png" },
}

export const viewport: Viewport = { themeColor: COLOR_TEMA }

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
