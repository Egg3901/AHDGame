import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { getDesktopLinkCookieOptions } from "@/lib/auth";
import { AUTH_COOKIE_NAME } from "@/lib/authCookieName";

export async function POST() {
  const auth = await requireBasicAuth();
  if (!auth.ok) return auth.response;

  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const response = NextResponse.json({ linked: true });
  response.cookies.set("auth-token", token, await getDesktopLinkCookieOptions());
  return response;
}
