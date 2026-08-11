// DELETE — revoke an extraction contract (admin only)

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound, badRequest } from "@/lib/api/errors";
import { schemas } from "@/lib/api/validate";
import type { GameState } from "@/lib/db/types/gameState";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    if (!schemas.objectId.safeParse(id).success) throw badRequest("Invalid contract ID");

    const db = await getDb();
    const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 0;

    const result = await db
      .collection("extractionContracts")
      .updateOne(
        { _id: new ObjectId(id), revokedTurn: { $exists: false } },
        { $set: { revokedTurn: currentTurn, updatedAt: new Date() } }
      );

    if (result.matchedCount === 0) throw notFound("Contract not found or already revoked");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
