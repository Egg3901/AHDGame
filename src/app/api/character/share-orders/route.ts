import { NextResponse } from "next/server";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { getMyOpenShareOrders } from "@/lib/corporations/queries/myOpenShareOrders";

// Per-user response keyed only to the session cookie (no id in the path). Open
// orders are per-character PII, so no-store keeps a URL-keyed CDN/edge cache
// from serving one player's orders to another.
const CACHE_HEADERS = { "Cache-Control": "no-store, no-transform" } as const;

/**
 * GET /api/character/share-orders
 * The authenticated character's OPEN share orders across every corporation.
 * Auth: requireBasicAuth
 */
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ orders: [] }, { headers: CACHE_HEADERS });
    }

    const orders = await getMyOpenShareOrders(db, character._id);
    return NextResponse.json({ orders }, { headers: CACHE_HEADERS });
  } catch (error) {
    return handleRouteError(error);
  }
}
