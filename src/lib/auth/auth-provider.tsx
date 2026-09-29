"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"

import { RUTA_INICIO } from "@/lib/domain/rules"
import type { Sesion, Usuario } from "@/lib/domain/types"
import { browserSupabase, edgeAccess } from "@/lib/services/edge"

interface AuthContextValue {
  sesion: Sesion | null
  usuario: Usuario | undefined
  login: (email: string, password: string, next?: string | null) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [supabaseSession, setSupabaseSession] = useState<{
    user: { id: string }
    expires_at?: number
  } | null>(null)

  useEffect(() => {
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
    queryKey: ["usuario-actual", supabaseSession?.user.id],
    queryFn: () => edgeAccess.authenticatedUser(),
    enabled: !!supabaseSession,
  })

  const sesion = useMemo(() => {
    if (!supabaseSession || !usuario) return null
    return {
      usuarioId: usuario.id,
      rol: usuario.rol,
      nombre: `${usuario.nombre} ${usuario.apellido}`.trim(),
      exp: (supabaseSession.expires_at ?? 0) * 1000,
    }
  }, [supabaseSession, usuario])

  const cerrar = useCallback(
    async (destino: string) => {
      try {
        const { error } = await browserSupabase().auth.signOut()
        if (error) throw error
      } catch {
        // Local state must be cleared even if the network sign-out cannot finish.
      } finally {
        queryClient.clear()
        router.replace(destino)
      }
    },
    [queryClient, router],
  )

  const logout = useCallback(() => {
    void cerrar("/login")
  }, [cerrar])

  const login = useCallback(
    async (email: string, password: string, next?: string | null) => {
      const u = await edgeAccess.login(email, password)
      queryClient.setQueryData(["usuario-actual", u.id], u)
      const destino =
        next && next.startsWith("/") && !next.startsWith("//") ? next : RUTA_INICIO[u.rol]
      // The session is persisted in cookies by Supabase asynchronously. A full
      // navigation makes the new cookies available to proxy.ts and the protected
      // server layouts before they validate the destination.
      window.location.replace(destino)
    },
    [queryClient],
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
