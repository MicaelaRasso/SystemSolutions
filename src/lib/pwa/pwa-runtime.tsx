"use client"

import { useEffect } from "react"

import { useAuth } from "@/lib/auth/auth-provider"
import { browserSupabase } from "@/lib/services/edge"

// Registra los listeners de instalación desde la carga inicial, en todas las pantallas.
import "./install-store"

/** Pantallas del Taller Móvil que tienen que abrir sin conexión (ADR 0009). */
const RUTAS_TALLER_SIN_CONEXION = ["/taller", "/taller/sincronizacion"]

const habilitado = () => process.env.NODE_ENV === "production" && "serviceWorker" in navigator

/** Quita el HTML guardado: el dispositivo puede ser compartido. */
async function limpiarHtmlTaller() {
  const registro = await navigator.serviceWorker.getRegistration()
  registro?.active?.postMessage({ tipo: "limpiar-html-taller" })
}

/**
 * Lo cargado antes de que el worker tomara el control no pasó por él. Se lo pasa ahora, junto con
 * las pantallas del taller, para que funcionen sin conexión desde la primera visita.
 */
async function sembrarTaller() {
  const registro = await navigator.serviceWorker.ready
  const estaticos = performance
    .getEntriesByType("resource")
    .map((recurso) => recurso.name)
    .filter((url) => url.startsWith(`${location.origin}/_next/static/`))
  const paginas = RUTAS_TALLER_SIN_CONEXION.map((ruta) => `${location.origin}${ruta}`)
  registro.active?.postMessage({ tipo: "sembrar-taller", urls: [...estaticos, ...paginas] })
}

/** Registra el service worker y le avisa cuando cambia la sesión. No dibuja nada. */
export function PwaRuntime() {
  const { usuario } = useAuth()
  const rol = usuario?.rol

  useEffect(() => {
    if (!habilitado()) return
    // Sin worker la app sigue andando con conexión: no hay nada que avisarle al usuario.
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => undefined)
    const {
      data: { subscription },
    } = browserSupabase().auth.onAuthStateChange((evento) => {
      if (evento === "SIGNED_OUT") void limpiarHtmlTaller()
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!rol || !habilitado()) return
    void (rol === "taller" ? sembrarTaller() : limpiarHtmlTaller())
  }, [rol])

  return null
}
