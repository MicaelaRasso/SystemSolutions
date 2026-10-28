import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { getSupabaseConfig } from "@/lib/supabase/config"

const INVITATION_SETUP_COOKIE = "ss_invitation_setup_user"

/** Completes Supabase Auth links and persists their cookie session. */
export async function GET(request: NextRequest) {
  const flow = request.nextUrl.searchParams.get("flow")
  const type = request.nextUrl.searchParams.get("type")
  const invitation = type === "invite" || (flow === "invite" && !type)
  const recovery = flow === "recovery"
  const emailChange = flow === "email-change" || flow === "workshop-email-change"
  const workshopEmailChange = flow === "workshop-email-change"
  const destination = invitation
    ? "/setup-password"
    : recovery
      ? "/reset-password"
      : emailChange
        ? workshopEmailChange ? "/login?emailChange=verified" : "/cuenta/seguridad?emailChange=verified"
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
  let error: Error | null = null
  let verifiedUserId: string | null = null

  if (code) {
    const result = await supabase.auth.exchangeCodeForSession(code)
    error = result.error
    verifiedUserId = result.data.user?.id ?? null
  } else if (
    tokenHash &&
    ((type === "invite" && invitation && !recovery && !emailChange) ||
      (type === "recovery" && recovery) ||
      (type === "email_change" && emailChange))
  ) {
    const result = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: invitation ? "invite" : recovery ? "recovery" : "email_change",
    })
    error = result.error
    verifiedUserId = result.data.user?.id ?? null
  } else {
    error = new Error("Missing or incompatible Auth link credentials")
  }

  if (invitation && !error && !verifiedUserId)
    error = new Error("Invitation link did not establish an Auth identity")

  if (error) {
    response.cookies.set(INVITATION_SETUP_COOKIE, "", { path: "/setup-password", maxAge: 0 })
    response.headers.set(
      "Location",
      new URL(
        recovery
          ? "/login?recovery=invalid"
          : emailChange
            ? workshopEmailChange ? "/login?emailChange=invalid" : "/cuenta/seguridad?emailChange=invalid"
            : "/login?invite=invalid",
        request.url,
      ).toString(),
    )
  } else if (invitation && verifiedUserId) {
    response.cookies.set(INVITATION_SETUP_COOKIE, verifiedUserId, {
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/setup-password",
      maxAge: 10 * 60,
    })
  } else {
    response.cookies.set(INVITATION_SETUP_COOKIE, "", { path: "/setup-password", maxAge: 0 })
  }

  return response
}
