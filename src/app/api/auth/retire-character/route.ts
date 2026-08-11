// POST — Retires the active character
// Auth: requireAuthWithCharacter
// Errors: 401 (unauthenticated or no character)

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/mongodb";
import { requireAuthWithCharacter } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { retireCharacter } from "@/lib/retireCharacter";
import { buildRetireRecapOpts } from "@/lib/recap/retireRecapOpts";
import { needsCharacterHint } from "@/lib/auth/characterGate";
import { setCharacterGateCookie } from "@/lib/auth/characterGateCookie";
import { ObjectId } from "mongodb";

export async function POST() {
  try {
    const auth = await requireAuthWithCharacter();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const userId = new ObjectId(auth.user.userId);

    // Build the Wrapped recap while actionLogs are still intact (no-op when the
    // gate is off); retireCharacter stamps it onto the archived doc.
    const recapOpts = await buildRetireRecapOpts(db, auth.user.character);
    await retireCharacter(db, auth.user.character, userId, "player_deleted", recapOpts);

    // The player now has no active character — gate them into /create-character
    // immediately (admins/moderators are exempt via needsCharacterHint).
    await setCharacterGateCookie(
      await cookies(),
      needsCharacterHint({
        role: auth.user.role,
        isAdmin: auth.user.isAdmin === true,
        hasCharacter: false,
      })
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
