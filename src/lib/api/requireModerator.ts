/**
 * Require moderator or admin auth for API route handlers.
 * Accepts users with role "moderator" or "admin".
 * @returns Moderator/admin user on success, or 403 NextResponse on failure
 */
import { NextResponse } from "next/server";
import { getAuthModerator } from "@/lib/auth";
import { forbidden } from "@/lib/api/errors";
import type { AuthUserWithCharacter } from "@/lib/auth";

export type ModeratorAuthResult =
  { ok: true; user: AuthUserWithCharacter } | { ok: false; response: NextResponse };

export async function requireModerator(): Promise<ModeratorAuthResult> {
  const user = await getAuthModerator();
  if (!user) {
    return { ok: false, response: NextResponse.json(forbidden().toJson(), { status: 403 }) };
  }
  return { ok: true, user };
}
