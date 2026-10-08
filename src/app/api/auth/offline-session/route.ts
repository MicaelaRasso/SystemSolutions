import { NextResponse } from "next/server"

import { OFFLINE_SESSION_COOKIE } from "@/lib/auth/offline-session"

export async function DELETE(request: Request) {
  const response = new NextResponse(null, {
    status: 204,
    headers: { "cache-control": "no-store" },
  })
  response.cookies.set(OFFLINE_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 0,
  })
  return response
}
