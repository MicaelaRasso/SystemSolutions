import { cn } from "@/lib/utils"

/**
 * `<select>` nativo con las medidas táctiles del sistema: 44 px de alto con puntero grueso y letra
 * de 16 px en pantallas táctiles (evita el zoom de iOS al enfocar). Úselo en vez de repetir las
 * clases en cada formulario; en el campo, el selector del sistema operativo es el más cómodo.
 */
export function SelectNativo({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select-nativo"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-base outline-none transition-colors pointer-coarse:h-11 pointer-fine:text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30",
        className,
      )}
      {...props}
    />
  )
}
