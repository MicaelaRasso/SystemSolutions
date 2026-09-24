"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react"

import { RUTA_INICIO } from "@/lib/domain/rules"
import type { Sesion, Usuario } from "@/lib/domain/types"
import { services } from "@/lib/services"

import {
  borrarSesionCookie,
  decodificarSesion,
  guardarSesionCookie,
  leerSesionCookieRaw,
  sesionDesdeUsuario,
  sesionExpirada,
} from "./session"

interface AuthContextValue {
  sesion: Sesion | null
  usuario: Usuario | undefined
  login: (email: string, password: string, next?: string | null) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// La cookie solo la modifica esta app: basta con notificar a mano tras cada cambio.
const listeners = new Set<() => void>()
const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
const notificar = () => listeners.forEach((l) => l())

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const raw = useSyncExternalStore(subscribe, leerSesionCookieRaw, () => null)
  const sesion = useMemo(() => {
    const s = decodificarSesion(raw ?? undefined)
    return s && !sesionExpirada(s) ? s : null
  }, [raw])

  const { data: usuario } = useQuery({
    queryKey: ["usuario-actual", sesion?.usuarioId],
    queryFn: () => services.usuarios.get(sesion!.usuarioId),
    enabled: !!sesion,
  })

  const cerrar = useCallback(
    (destino: string) => {
      borrarSesionCookie()
      notificar()
      queryClient.clear()
      router.replace(destino)
    },
    [queryClient, router],
  )

  const logout = useCallback(() => cerrar("/login"), [cerrar])

  // Expiración durante el uso: vuelve al login con aviso.
  useEffect(() => {
    if (!sesion) return
    const restante = Math.max(0, Math.min(sesion.exp - Date.now(), 2 ** 31 - 1))
    const timer = setTimeout(() => cerrar("/login?expirada=1"), restante)
    return () => clearTimeout(timer)
  }, [sesion, cerrar])

  const login = useCallback(
    async (email: string, password: string, next?: string | null) => {
      const u = await services.auth.login(email, password)
      guardarSesionCookie(sesionDesdeUsuario(u))
      notificar()
      queryClient.setQueryData(["usuario-actual", u.id], u)
      const destino =
        next && next.startsWith("/") && !next.startsWith("//") ? next : RUTA_INICIO[u.rol]
      router.replace(destino)
    },
    [queryClient, router],
  )

  const value = useMemo(
    () => ({ sesion, usuario, login, logout }),
    [sesion, usuario, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>")
  return ctx
}
