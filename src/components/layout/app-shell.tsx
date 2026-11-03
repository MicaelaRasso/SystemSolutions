"use client"

import { ChevronsUpDown, LoaderCircle, LogOut } from "lucide-react"
import Link, { useLinkStatus } from "next/link"
import { usePathname } from "next/navigation"

import { Logo } from "@/components/brand/logo"
import { InstalarAppButton } from "@/components/common/instalar-app-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { esActivo, NAVEGACION } from "@/config/navigation"
import { useAuth } from "@/lib/auth/auth-provider"
import { ROL_LABEL } from "@/lib/domain/rules"
import type { Rol } from "@/lib/domain/types"
import { cn } from "@/lib/utils"

function iniciales(nombre: string) {
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

function MenuUsuario({ rol }: { rol: Rol }) {
  const { sesion, logout } = useAuth()
  const { isMobile } = useSidebar()
  const nombre = sesion?.nombre ?? "…"

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <Avatar className="size-8 rounded-lg">
                <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {iniciales(nombre)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{nombre}</span>
                <span className="truncate text-xs opacity-70">{ROL_LABEL[rol]}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="text-sm font-medium">{nombre}</div>
              <div className="text-xs text-muted-foreground">{ROL_LABEL[rol]}</div>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={logout} variant="destructive">
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * Rueda chica junto al ítem del menú mientras la navegación todavía no arrancó (por ejemplo, si el
 * prefetch no terminó). Tamaño fijo y solo cambia la opacidad, para no mover el layout.
 */
function NavegacionPendiente() {
  const { pending } = useLinkStatus()
  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto flex opacity-0 transition-opacity group-data-[collapsible=icon]:hidden",
        pending && "opacity-70",
      )}
    >
      <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />
    </span>
  )
}

function Navegacion({ rol }: { rol: Rol }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  return (
    <>
      {NAVEGACION[rol].map((grupo) => (
        <SidebarGroup key={grupo.titulo}>
          <SidebarGroupLabel className="text-sidebar-foreground/60">
            {grupo.titulo}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {grupo.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={esActivo(item.href, pathname)}
                    tooltip={item.titulo}
                  >
                    <Link href={item.href} onClick={() => isMobile && setOpenMobile(false)}>
                      <item.icono />
                      <span className="truncate">{item.titulo}</span>
                      <NavegacionPendiente />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  )
}

export function AppShell({ rol, children }: { rol: Rol; children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader className="items-center py-4 group-data-[collapsible=icon]:py-3">
          <Logo variant="light" className="text-sm group-data-[collapsible=icon]:text-[0.45rem]" />
        </SidebarHeader>
        <SidebarContent>
          <Navegacion rol={rol} />
        </SidebarContent>
        <SidebarFooter>
          <MenuUsuario rol={rol} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-10 flex h-12 shrink-0 pointer-coarse:h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1 pointer-coarse:size-11" aria-label="Abrir o cerrar el menú" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm text-muted-foreground">
            <span className="sm:hidden">System Solutions</span>
            <span className="hidden sm:inline">
              Gestión de calibración de válvulas de seguridad
            </span>
          </span>
          <InstalarAppButton />
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
