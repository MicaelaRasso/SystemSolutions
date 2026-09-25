import { Badge } from "@/components/ui/badge"
import { estadoFirma, vigencia, type EstadoFirma, type EstadoVigencia } from "@/lib/domain/rules"
import type { Certificado } from "@/lib/domain/types"
import { cn } from "@/lib/utils"

const VIGENCIA: Record<EstadoVigencia, { label: string; className: string }> = {
  vigente: { label: "Vigente", className: "bg-emerald-100 text-emerald-800" },
  por_vencer: { label: "Por vencer", className: "bg-amber-100 text-amber-900" },
  vencido: { label: "Vencido", className: "bg-zinc-200 text-zinc-700" },
}

const FIRMA: Record<EstadoFirma, { label: string; className: string }> = {
  firmado: { label: "Firmado", className: "bg-sky-100 text-sky-800" },
  firma_tecnico: { label: "Requiere firma", className: "bg-orange-100 text-orange-900" },
  sin_firmas: { label: "Sin firmas", className: "bg-red-100 text-red-800" },
}

export function VigenciaBadge({ fechaEjecucion }: { fechaEjecucion: string }) {
  const { estado } = vigencia(fechaEjecucion)
  const v = VIGENCIA[estado]
  return <Badge className={cn("border-transparent", v.className)}>{v.label}</Badge>
}

export function FirmaBadge({ cert }: { cert: Pick<Certificado, "firmaTecnico" | "firmaCliente"> }) {
  const f = FIRMA[estadoFirma(cert)]
  return <Badge className={cn("border-transparent", f.className)}>{f.label}</Badge>
}

export function EstadoActivoBadge({ activo }: { activo: boolean }) {
  return activo ? (
    <Badge className="border-transparent bg-emerald-100 text-emerald-800">Activo</Badge>
  ) : (
    <Badge variant="secondary">Inactivo</Badge>
  )
}
