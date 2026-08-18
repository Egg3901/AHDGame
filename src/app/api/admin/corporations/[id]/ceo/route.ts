// POST /api/admin/corporations/[id]/ceo — appoint CEO by character ID
// DELETE /api/admin/corporations/[id]/ceo — vacate CEO position
// Auth: requireAdmin
// Errors: 403, 400, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { parseJsonBody } from "@/lib/api/validate";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Character, Corporation, GameState } from "@/lib/db/types";
import { openCeoTenure, closeCeoTenure } from "@/lib/corporations/ceoHistory";
import { getCurrentTurn } from "@/lib/turn/currentTurn";

const appointSchema = z.object({ characterId: z.string().length(24) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const parsed = await parseJsonBody(request, appointSchema);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });

    const { characterId } = parsed.data;
    const db = await getDb();

    const corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) });
    if (!corp) throw notFound("Corporation not found");

    // Resolve the appointed character's owning user. The corp's `userId` is the
    // SSOT for CEO authorization (requireCeo) and private-data access
    // (shouldRedactCorporation), so it MUST be stamped here exactly like the
    // player-facing /ceo/accept flow. Without it an appointed CEO is treated as
    // an outsider and sees the redacted "private corporation" view.
    const character = await db
      .collection<Character>("characters")
      .findOne({ _id: new ObjectId(characterId) }, { projection: { userId: 1 } });
    if (!character) throw notFound("Character not found");

    // `ceoType` MUST be stamped, not just left alone: the seat may previously
    // have been held by an NPP (spawned or caretaker) or an imperial character,
    // and corporationDetail resolves the CEO from the collection named by
    // `ceoType`. A stale "npp" makes the corp page render "CEO Vacant" while a
    // live character sits in `ceoId`. Any caretaker record dies with the
    // handover — leaving it would let a later dismissal restore the old human
    // over the one just appointed.
    await db.collection<Corporation>("corporations").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ceoId: new ObjectId(characterId),
          ceoType: "character",
          userId: character.userId,
          ceoVacant: false,
          pendingCeoCharacterId: undefined,
          updatedAt: new Date(),
        },
        $unset: { ceoVacantSinceTurn: "", caretakerCeo: "" },
      }
    );

    await openCeoTenure(db, new ObjectId(id), {
      holderId: new ObjectId(characterId),
      ceoType: "character",
      turn: await getCurrentTurn(db),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    // Record the turn when the vacancy began
    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = gameState?.currentTurn ?? 0;

    // Capture the outgoing CEO before vacating so we can close their tenure.
    const outgoing = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: new ObjectId(id) }, { projection: { ceoId: 1 } });

    const result = await db.collection<Corporation>("corporations").updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ceoVacant: true,
          ceoVacantSinceTurn: currentTurn,
          updatedAt: new Date(),
        },
      }
    );
    if (result.matchedCount === 0) throw notFound("Corporation not found");

    if (outgoing?.ceoId) {
      await closeCeoTenure(db, new ObjectId(id), { holderId: outgoing.ceoId, turn: currentTurn });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
