/**
 * Auth helper that accepts either an admin session cookie OR an internal API key.
 * Use for routes that need to be callable by Claude/scripts via X-Api-Key header.
 *
 * API key is set via INTERNAL_API_KEY in .env.local.
 * Usage: curl -H "X-Api-Key: <key>" http://localhost:3000/api/admin/tasks
 */
import { NextResponse } from "next/server";
import { getAuthAdmin } from "@/lib/auth";
import { forbidden, unauthorized } from "@/lib/api/errors";
import type { AuthUserWithCharacter } from "@/lib/auth";
import crypto from "crypto";

export type AdminOrApiKeyResult =
  | { ok: true; via: "session"; admin: AuthUserWithCharacter }
  | { ok: true; via: "apiKey"; admin: null }
  | { ok: false; response: NextResponse };

export async function requireAdminOrApiKey(request: Request): Promise<AdminOrApiKeyResult> {
  // Check API key first (fast path for scripts/Claude)
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) {
    const expected = process.env.INTERNAL_API_KEY;
    if (!expected) {
      return {
        ok: false,
        response: NextResponse.json({ error: "INTERNAL_API_KEY not configured" }, { status: 500 }),
      };
    }
    // Length check before timingSafeEqual to avoid Buffer length mismatch errors
    if (
      apiKey.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(apiKey), Buffer.from(expected))
    ) {
      return { ok: true, via: "apiKey", admin: null };
    }
    return { ok: false, response: NextResponse.json(unauthorized().toJson(), { status: 401 }) };
  }

  // Fall back to session auth
  const admin = await getAuthAdmin();
  if (!admin) {
    return { ok: false, response: NextResponse.json(forbidden().toJson(), { status: 403 }) };
  }
  return { ok: true, via: "session", admin };
}
