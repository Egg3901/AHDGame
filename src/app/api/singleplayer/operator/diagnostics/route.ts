import { NextResponse } from "next/server";
import { requireSingleplayer } from "@/lib/api/requireSingleplayer";
import { getDb } from "@/lib/mongodb";
import type { GameState } from "@/lib/db/types";

export async function GET(request: Request) {
  const denied = requireSingleplayer(request);
  if (denied) return denied;
  const db = await getDb();
  const [state, characters, corporations, parties] = await Promise.all([
    db
      .collection<GameState>("gameState")
      .findOne(
        { _id: "current" },
        { projection: { currentTurn: 1, preset: 1, isProcessing: 1, singleplayerTurnMetrics: 1 } }
      ),
    db.collection("characters").countDocuments({ retiredAt: { $exists: false } }),
    db.collection("corporations").countDocuments(),
    db.collection("politicalParties").countDocuments(),
  ]);
  if (!state) return NextResponse.json({ error: "No local world" }, { status: 409 });
  return NextResponse.json(
    {
      turn: state.currentTurn,
      preset: state.preset ?? null,
      processing: state.isProcessing === true,
      counts: { characters, corporations, parties },
      lastTurn: state.singleplayerTurnMetrics
        ? {
            durationMs: state.singleplayerTurnMetrics.durationMs,
            warningCount: state.singleplayerTurnMetrics.warningCount,
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
