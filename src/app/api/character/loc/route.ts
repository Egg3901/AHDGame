// GET /api/character/loc — Line-of-credit snapshot and recent ledger (forex + feature flag required)
// Auth: requireBasicAuth
// Errors: 401, 404

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import { fetchLocLedgerForCharacter } from "@/lib/lineOfCredit/ledger";

export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    }

    const snapshot = await buildLocSnapshot(db, character);
    if (!snapshot) {
      return NextResponse.json({ error: "Line of credit is not available" }, { status: 404 });
    }

    const ledger = await fetchLocLedgerForCharacter(db, character._id, 50);

    return NextResponse.json({
      ...snapshot,
      ledger,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
