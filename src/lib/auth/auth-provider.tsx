"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import { RUTA_INICIO } from "@/lib/domain/rules"
import type { Sesion, Usuario } from "@/lib/domain/types"
import { browserSupabase, edgeAccess } from "@/lib/services/edge"
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
const usesSupabaseAuth = process.env.NEXT_PUBLIC_DATA_SOURCE === "supabase"

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
  const [supabaseSession, setSupabaseSession] = useState<{
    user: { id: string }
    expires_at?: number
  } | null>(null)

  const raw = useSyncExternalStore(subscribe, leerSesionCookieRaw, () => null)
  const mockSesion = useMemo(() => {
    const s = decodificarSesion(raw ?? undefined)
    return s && !sesionExpirada(s) ? s : null
  }, [raw])

  useEffect(() => {
    if (!usesSupabaseAuth) return

    const client = browserSupabase()
    let active = true
    void client.auth.getSession().then(({ data }) => {
      if (active) setSupabaseSession(data.session)
    })
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      setSupabaseSession(session)
      if (event === "SIGNED_OUT") {
        queryClient.clear()
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [queryClient])

  const { data: usuario } = useQuery({
    queryKey: ["usuario-actual", usesSupabaseAuth ? supabaseSession?.user.id : mockSesion?.usuarioId],
    queryFn: () => usesSupabaseAuth
      ? edgeAccess.authenticatedUser()
      : services.usuarios.get(mockSesion!.usuarioId),
    enabled: usesSupabaseAuth ? !!supabaseSession : !!mockSesion,
  })

  const sesion = useMemo(() => {
    if (!usesSupabaseAuth) return mockSesion
    if (!supabaseSession || !usuario) return null
    return {
      usuarioId: usuario.id,
      rol: usuario.rol,
      nombre: `${usuario.nombre} ${usuario.apellido}`.trim(),
      exp: (supabaseSession.expires_at ?? 0) * 1000,
    }
  }, [mockSesion, supabaseSession, usuario])

  const cerrar = useCallback(
    async (destino: string) => {
      try {
        await services.auth.logout?.()
      } catch {
        // Local state must be cleared even if the network sign-out cannot finish.
      } finally {
        if (!usesSupabaseAuth) {
          borrarSesionCookie()
          notificar()
        }
        queryClient.clear()
        router.replace(destino)
      }
    },
    [queryClient, router],
  )

  const logout = useCallback(() => {
    void cerrar("/login")
  }, [cerrar])

  // Expiración durante el uso: vuelve al login con aviso.
  useEffect(() => {
    if (usesSupabaseAuth) return
    if (!sesion) return
    const restante = Math.max(0, Math.min(sesion.exp - Date.now(), 2 ** 31 - 1))
    const timer = setTimeout(() => void cerrar("/login?expirada=1"), restante)
    return () => clearTimeout(timer)
  }, [sesion, cerrar])

  const login = useCallback(
    async (email: string, password: string, next?: string | null) => {
      const u = await services.auth.login(email, password)
      if (!usesSupabaseAuth) {
        guardarSesionCookie(sesionDesdeUsuario(u))
        notificar()
      }
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
