import {
  Archive,
  Building2,
  CalendarDays,
  ClipboardList,
  DatabaseBackup,
  FileCheck2,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Truck,
  UserCircle,
  type LucideIcon,
} from "lucide-react"

import type { Rol } from "@/lib/domain/types"

export interface NavItem {
  titulo: string
  href: string
  icono: LucideIcon
}

export interface NavGrupo {
  titulo: string
  items: NavItem[]
}

const ADMIN: NavGrupo[] = [
  {
    titulo: "Operación",
    items: [
      { titulo: "Panel", href: "/admin", icono: LayoutDashboard },
      { titulo: "Agenda", href: "/admin/agenda", icono: CalendarDays },
      { titulo: "Cronograma", href: "/admin/cronograma", icono: Truck },
      { titulo: "Tareas", href: "/admin/tareas", icono: ClipboardList },
      { titulo: "Certificados", href: "/admin/certificados", icono: FileCheck2 },
    ],
  },
  {
    titulo: "Gestión",
    items: [
      { titulo: "Clientes", href: "/admin/clientes", icono: Building2 },
      { titulo: "Talleres y personal", href: "/admin/talleres", icono: Truck },
      { titulo: "Catálogos", href: "/admin/catalogos", icono: ListChecks },
      { titulo: "Config. certificado", href: "/admin/configuracion/certificado", icono: Settings2 },
      { titulo: "Backups", href: "/admin/backups", icono: DatabaseBackup },
    ],
  },
]

const SUPERADMIN: NavGrupo = {
  titulo: "Súper Administrador",
  items: [
    { titulo: "Administradores", href: "/superadmin/administradores", icono: ShieldCheck },
    { titulo: "Backups por fecha", href: "/superadmin/backups", icono: Archive },
  ],
}

const TALLER: NavGrupo[] = [
  {
    titulo: "Campo",
    items: [
      { titulo: "Mis tareas", href: "/taller", icono: ClipboardList },
      { titulo: "Sincronización", href: "/taller/sincronizacion", icono: RefreshCw },
    ],
  },
]

const CLIENTE: NavGrupo[] = [
  {
    titulo: "Portal",
    items: [
      { titulo: "Calendario", href: "/portal", icono: CalendarDays },
      { titulo: "Turnos", href: "/portal/turnos", icono: ClipboardList },
      { titulo: "Certificados", href: "/portal/certificados", icono: FileCheck2 },
      { titulo: "Mi empresa", href: "/portal/empresa", icono: UserCircle },
    ],
  },
]

export const NAVEGACION: Record<Rol, NavGrupo[]> = {
  superadmin: [...ADMIN, SUPERADMIN],
  admin: ADMIN,
  taller: TALLER,
  cliente: CLIENTE,
}

/** Item activo: coincidencia exacta para las raíces de sección, prefijo para el resto. */
export function esActivo(href: string, pathname: string) {
  const raices = ["/admin", "/taller", "/portal"]
  if (raices.includes(href)) return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
