import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { getSupabaseConfig } from "@/lib/supabase/config"

/** Completes Supabase Auth links and persists their cookie session. */
export async function GET(request: NextRequest) {
  const flow = request.nextUrl.searchParams.get("flow")
  const recovery = flow === "recovery"
  const emailChange = flow === "email-change"
  const destination = recovery
    ? "/reset-password"
    : emailChange
      ? "/cuenta/seguridad?emailChange=verified"
      : "/setup-password"
  const url = new URL(destination, request.url)
  const response = NextResponse.redirect(url)
  const { url: supabaseUrl, publishableKey } = getSupabaseConfig()
  const supabase = createServerClient(supabaseUrl, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const code = request.nextUrl.searchParams.get("code")
  const tokenHash = request.nextUrl.searchParams.get("token_hash")
  const type = request.nextUrl.searchParams.get("type")
  let error: Error | null = null

  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code)
    error = result.error
  } else if (
    tokenHash &&
    ((type === "invite" && !recovery && !emailChange) ||
      (type === "recovery" && recovery) ||
      (type === "email_change" && emailChange))
  ) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: recovery ? "recovery" : emailChange ? "email_change" : "invite",
    })
    error = result.error
  } else {
    error = new Error("Missing or incompatible Auth link credentials")
  }

  if (error) {
    response.headers.set(
      "Location",
      new URL(
        recovery
          ? "/login?recovery=invalid"
          : emailChange
            ? "/cuenta/seguridad?emailChange=invalid"
            : "/login?invite=invalid",
        request.url,
      ).toString(),
    )
  }

  return response
}
