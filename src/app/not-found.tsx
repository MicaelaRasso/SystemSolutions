import { FileQuestion } from "lucide-react"
import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="max-w-md space-y-5 text-center">
        <div className="mx-auto w-fit rounded-full bg-muted p-4">
          <FileQuestion className="size-8 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Página no encontrada</h1>
          <p className="text-sm text-muted-foreground">
            La dirección no existe o el registro fue eliminado.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Volver al inicio</Link>
        </Button>
      </div>
    </main>
  )
}
