// POST /api/admin/corporations/[id]/suspend
// Marks a corporation as suspended — skipped by turn processing until resumed.
// Auth: requireAdmin
// Errors: 401, 403, 404

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError, notFound } from "@/lib/api/errors";
import type { Corporation, GameState } from "@/lib/db/types";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { id } = await params;
    const db = await getDb();

    const gameState = await db
      .collection<GameState>("gameState")
      .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
    const currentTurn = gameState?.currentTurn ?? 0;

    const result = await db
      .collection<Corporation>("corporations")
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { suspended: true, suspendedUntilTurn: currentTurn, updatedAt: new Date() } }
      );
    if (result.matchedCount === 0) throw notFound("Corporation not found");

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
