"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { edgeApi } from "@/lib/api"
import { identityInvalidations } from "@/lib/api/identity"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import type { AccountDto } from "@/lib/api/contracts"

const key = ["edge", "identity", "administrators"] as const

function estadoLabel(account: AccountDto) {
  if (account.estado === "pendiente") return "Invitación pendiente"
  if (account.estado === "deshabilitada") return "Deshabilitada"
  return "Activa"
}

export function AdministradoresPanel() {
  const client = useQueryClient()
  const [email, setEmail] = useState("")
  const [nombre, setNombre] = useState("")
  const [apellido, setApellido] = useState("")
  const [rol, setRol] = useState<"administrador_regular" | "super_administrador">("administrador_regular")
  const list = useQuery({ queryKey: key, queryFn: edgeApi.identity.administrators.list })
  const refresh = () => Promise.all(identityInvalidations.map((queryKey) => client.invalidateQueries({ queryKey })))

  const create = useMutation({
    mutationFn: () => edgeApi.identity.administrators.create({ email: email.trim(), nombre: nombre.trim(), apellido: apellido.trim(), rol }),
    onSuccess: async () => {
      toast.success("Invitación enviada")
      setEmail(""); setNombre(""); setApellido("")
      await refresh()
    },
    onError: () => toast.error("No se pudo crear la cuenta. Revisa los datos e intenta de nuevo."),
  })
  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => edgeApi.identity.administrators.setActive(id, active),
    onSuccess: async (_account, variables) => {
      toast.success(variables.active ? "Cuenta reactivada" : "Cuenta deshabilitada")
      await refresh()
    },
    onError: () => toast.error("No se pudo actualizar la cuenta"),
  })
  const resend = useMutation({
    mutationFn: (id: string) => edgeApi.identity.administrators.resendInvitation(id),
    onSuccess: () => toast.success("Invitación reenviada"),
    onError: () => toast.error("No se pudo reenviar la invitación"),
  })
  const recover = useMutation({
    mutationFn: (id: string) => edgeApi.identity.triggerPasswordRecovery(id),
    onSuccess: () => toast.success("Si la cuenta puede recibir recuperación, se enviará un correo."),
    onError: () => toast.error("No se pudo procesar la solicitud. Intenta de nuevo más tarde."),
  })

  return (
    <main className="space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold">Administradores</h1>
        <p className="text-muted-foreground">Crea y administra las cuentas con acceso administrativo.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Invitar administrador</CardTitle>
          <CardDescription>Se enviará un correo para que la persona configure su acceso.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
            <div className="space-y-2"><Label htmlFor="admin-email">Correo</Label><Input id="admin-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="admin-role">Rol</Label><select id="admin-role" className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={rol} onChange={(event) => setRol(event.target.value as typeof rol)}><option value="administrador_regular">Administrador</option><option value="super_administrador">Superadministrador</option></select></div>
            <div className="space-y-2"><Label htmlFor="admin-name">Nombre</Label><Input id="admin-name" required value={nombre} onChange={(event) => setNombre(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="admin-lastname">Apellido</Label><Input id="admin-lastname" required value={apellido} onChange={(event) => setApellido(event.target.value)} /></div>
            <div className="md:col-span-2"><Button type="submit" disabled={create.isPending}>{create.isPending ? "Enviando…" : "Enviar invitación"}</Button></div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Cuentas administrativas</CardTitle><CardDescription>Las cuentas pendientes aún no han terminado de configurar el acceso.</CardDescription></CardHeader>
        <CardContent>
          {list.isLoading ? <p role="status">Cargando cuentas…</p> : list.isError ? <div className="space-y-3"><p role="alert">No se pudieron cargar las cuentas.</p><Button variant="outline" onClick={() => void list.refetch()}>Reintentar</Button></div> : !list.data?.length ? <p className="text-sm text-muted-foreground">Todavía no hay cuentas administrativas.</p> : (
            <div className="space-y-3">
              {list.data.map((account) => (
                <section key={account.id} className="flex flex-col justify-between gap-3 rounded-lg border p-4 md:flex-row md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{account.nombre} {account.apellido}</p><Badge variant={account.estado === "activa" ? "default" : "secondary"}>{estadoLabel(account)}</Badge><Badge variant="outline">{account.rol === "super_administrador" ? "Superadministrador" : "Administrador"}</Badge></div>
                    <p className="text-sm text-muted-foreground">{account.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {account.estado === "pendiente" && <Button variant="outline" disabled={resend.isPending} onClick={() => resend.mutate(account.id)}>Reenviar invitación</Button>}
                    {account.estado === "activa" && <Button variant="outline" disabled={recover.isPending} onClick={() => recover.mutate(account.id)}>Enviar recuperación de contraseña</Button>}
                    {account.estado !== "pendiente" && <Button variant="outline" disabled={setActive.isPending} onClick={() => setActive.mutate({ id: account.id, active: account.estado !== "activa" })}>{account.estado === "activa" ? "Deshabilitar" : "Reactivar"}</Button>}
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
