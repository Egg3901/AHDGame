// GET — Fetches a single retired character by _id for the account owner
// Auth: requireBasicAuth (verify userId matches authenticated user)
// Errors: 401, 404

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { notFound } from "@/lib/api/errors";
import { ObjectId } from "mongodb";
import type { RetiredCharacter } from "@/lib/db/types/retiredCharacter";
import type { GameState } from "@/lib/db/types";
import { gameDateAnchorFromState } from "@/lib/utils/gameDate";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const { id } = await params;

    if (!ObjectId.isValid(id)) {
      throw notFound("Retired character not found");
    }

    const db = await getDb();
    const [retired, gameState] = await Promise.all([
      db.collection<RetiredCharacter>("retiredCharacters").findOne({ _id: new ObjectId(id) }),
      db.collection<GameState>("gameState").findOne({ _id: "current" }),
    ]);

    if (!retired) {
      throw notFound("Retired character not found");
    }

    // Verify the retired character belongs to the authenticated user
    const userId = new ObjectId(auth.user.userId);
    if (!retired.userId.equals(userId)) {
      throw notFound("Retired character not found");
    }

    return NextResponse.json({
      retiredCharacter: retired,
      gameDateAnchor: gameState ? gameDateAnchorFromState(gameState) : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
