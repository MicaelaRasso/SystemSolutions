import { cn } from "@/lib/utils"

/** Recreación del wordmark del certificado modelo hasta recibir el logo en alta resolución. */
export function Logo({
  className,
  variant = "color",
}: {
  className?: string
  variant?: "color" | "light"
}) {
  const texto = variant === "light" ? "text-white" : "text-primary"
  return (
    <div className={cn("inline-flex flex-col items-center leading-none select-none", className)}>
      <span className={cn("text-[1.05em] font-black tracking-[0.12em]", texto)}>SYSTEM</span>
      <span className={cn("text-[1.05em] font-black tracking-[0.02em]", texto)}>SOLUTIONS</span>
      <svg viewBox="0 0 100 8" className="mt-[0.15em] h-[0.4em] w-full" aria-hidden>
        <path d="M0 6 Q 50 -2 100 4 L 100 6 Q 50 1 0 8 Z" fill="oklch(0.72 0.13 215)" />
      </svg>
    </div>
  )
}
