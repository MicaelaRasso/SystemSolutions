import { Building2 } from "lucide-react"

import { cn } from "@/lib/utils"

export function EmpresaLogo({
  logoUrl,
  nombre,
  className,
}: {
  logoUrl?: string
  nombre: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white",
        className,
      )}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URL / Storage, sin optimización
        <img src={logoUrl} alt={`Logo de ${nombre}`} className="size-full object-contain p-1" />
      ) : (
        <Building2 className="size-1/2 text-muted-foreground" aria-hidden />
      )}
    </div>
  )
}
