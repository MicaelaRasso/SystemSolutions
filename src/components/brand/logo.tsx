import Image from "next/image"

import { cn } from "@/lib/utils"

const ANCHO = 1055
const ALTO = 320
const COLOR = "/brand/logo-system-solutions.png"
const BLANCO = "/brand/logo-system-solutions-blanco.png"

/**
 * Logo oficial de System Solutions (archivo provisto por el cliente). Se dimensiona con el
 * tamaño de letra del contenedor (`text-*`), como el wordmark anterior.
 *
 * - `auto` (por defecto): letras azules en tema claro y blancas en tema oscuro.
 * - `color`: siempre azul; para el certificado, que se imprime sobre blanco.
 * - `light`: siempre blanco; para fondos oscuros como la barra lateral.
 */
export function Logo({
  className,
  variant = "auto",
}: {
  className?: string
  variant?: "auto" | "color" | "light"
}) {
  const clases = "h-[2.6em] w-auto max-w-full object-contain"
  return (
    <span className={cn("inline-flex select-none", className)}>
      {variant === "light" ? (
        <Image src={BLANCO} alt="System Solutions" width={ANCHO} height={ALTO} className={clases} />
      ) : variant === "color" ? (
        <Image src={COLOR} alt="System Solutions" width={ANCHO} height={ALTO} className={clases} />
      ) : (
        <>
          <Image
            src={COLOR}
            alt="System Solutions"
            width={ANCHO}
            height={ALTO}
            className={cn(clases, "dark:hidden")}
          />
          <Image
            src={BLANCO}
            alt="System Solutions"
            width={ANCHO}
            height={ALTO}
            className={cn(clases, "hidden dark:block")}
          />
        </>
      )}
    </span>
  )
}
