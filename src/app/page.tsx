import { redirect } from "next/navigation"

/** `proxy.ts` redirige según la sesión; esto es solo un respaldo. */
export default function Home() {
  redirect("/login")
}
