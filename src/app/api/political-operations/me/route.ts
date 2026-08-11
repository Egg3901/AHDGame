import { NextResponse } from "next/server";
import { handleRouteError, forbidden } from "@/lib/api/errors";
import { loadPoliticalOperationsData } from "@/app/political-operations/loaders";

// Per-user response with no id in the path — no-store prevents a URL-keyed edge
// cache from serving one player's snapshot to another.
const NO_STORE = { "Cache-Control": "no-store, no-transform" } as const;

/**
 * GET /api/political-operations/me
 * Returns the authenticated US character's political-operations snapshot.
 * Auth: requireAuthWithCharacter (handled inside loadPoliticalOperationsData)
 * Errors: 401 (no auth), 403 (non-US character)
 */
export async function GET() {
  try {
    const data = await loadPoliticalOperationsData();
    if (!data) {
      return NextResponse.json(forbidden("Political Operations is a US-only feature").toJson(), {
        status: 403,
      });
    }
    return NextResponse.json(data, { headers: NO_STORE });
  } catch (error) {
    return handleRouteError(error);
  }
}
