// GET /api/character/loc — Line-of-credit snapshot and recent ledger (forex + feature flag required)
// Auth: requireBasicAuth
// Errors: 401, 404

import { NextResponse } from "next/server";
import { withNoStore } from "@/lib/api/withNoStore";
import { getDb } from "@/lib/mongodb";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError, errorResponse } from "@/lib/api/errors";
import { buildLocSnapshot } from "@/lib/lineOfCredit/buildSnapshot";
import { fetchLocLedgerForCharacter } from "@/lib/lineOfCredit/ledger";

async function handleGET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const character = await getCharacterByUserId(db, auth.user.userId);
    if (!character) {
      return errorResponse(404, "Character not found");
    }

    const snapshot = await buildLocSnapshot(db, character);
    if (!snapshot) {
      return errorResponse(404, "Line of credit is not available");
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

export const GET = withNoStore(handleGET);
