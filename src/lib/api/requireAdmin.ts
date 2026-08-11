/**
 * Require admin auth for API route handlers.
 * Use at the start of admin route handlers.
 * @returns Admin user on success, or 403 NextResponse on failure
 */
import { NextResponse } from "next/server";
import { getAuthAdmin } from "@/lib/auth";
import { forbidden } from "@/lib/api/errors";
import type { AuthUserWithCharacter } from "@/lib/auth";

export type AdminAuthResult =
  { ok: true; admin: AuthUserWithCharacter } | { ok: false; response: NextResponse };

export async function requireAdmin(): Promise<AdminAuthResult> {
  const admin = await getAuthAdmin();
  if (!admin) {
    return { ok: false, response: NextResponse.json(forbidden().toJson(), { status: 403 }) };
  }
  return { ok: true, admin };
}
