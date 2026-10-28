import { NextResponse, type NextRequest } from "next/server"

const INVITATION_SETUP_COOKIE = "ss_invitation_setup_user"

export function DELETE(request: NextRequest) {
  const response = NextResponse.json({ cleared: true })
  response.cookies.set(INVITATION_SETUP_COOKIE, "", {
    path: "/setup-password",
    maxAge: 0,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    httpOnly: true,
  })
  return response
}
