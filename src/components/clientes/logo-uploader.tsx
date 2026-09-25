"use client"

import { ImageUp, Trash2 } from "lucide-react"
import { useRef } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Empresa } from "@/lib/domain/types"
import { qk, useServiceMutation } from "@/lib/hooks/queries"
import { services } from "@/lib/services"

import { EmpresaLogo } from "./empresa-logo"

const TIPOS = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"]
const MAX_MB = 2

/** Logo del cliente (RF-07). Se imprime automáticamente en sus certificados (RF-09). */
export function LogoUploader({ empresa }: { empresa: Empresa }) {
  const input = useRef<HTMLInputElement>(null)
  const guardar = useServiceMutation(
    (archivo: File | null) => services.empresas.setLogo(empresa.id, archivo),
    { invalidar: [qk.empresa(empresa.id), ["empresas"]] },
  )

  function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ""
    if (!archivo) return
    if (!TIPOS.includes(archivo.type)) {
      toast.error("Formato no admitido. Usá PNG, JPG, SVG o WebP.")
      return
    }
    if (archivo.size > MAX_MB * 1024 * 1024) {
      toast.error(`El archivo supera los ${MAX_MB} MB.`)
      return
    }
    guardar.mutate(archivo, { onSuccess: () => toast.success("Logo actualizado") })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Logo del cliente</CardTitle>
        <CardDescription>Se imprime en la cabecera de todos sus certificados.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <EmpresaLogo
          logoUrl={empresa.logoUrl}
          nombre={empresa.razonSocial}
          className="size-32 rounded-xl"
        />
        <input
          ref={input}
          type="file"
          accept={TIPOS.join(",")}
          className="sr-only"
          onChange={elegir}
          aria-label="Archivo de logo"
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={guardar.isPending}
            onClick={() => input.current?.click()}
          >
            <ImageUp />
            {guardar.isPending ? "Procesando…" : empresa.logoUrl ? "Reemplazar" : "Subir logo"}
          </Button>
          {empresa.logoUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={guardar.isPending}
              onClick={() =>
                guardar.mutate(null, { onSuccess: () => toast.success("Logo quitado") })
              }
            >
              <Trash2 />
              Quitar
            </Button>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">
          PNG, JPG, SVG o WebP · hasta {MAX_MB} MB · fondo transparente recomendado
        </p>
      </CardContent>
    </Card>
  )
}
