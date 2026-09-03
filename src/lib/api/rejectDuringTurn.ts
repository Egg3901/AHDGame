import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types";
import { isTurnProcessingNow } from "@/lib/turn/processingLock";

/**
 * Reject a player mutation while a live turn lock is processing snapshots of
 * the same economy. Stale locks do not block play.
 */
export async function rejectDuringTurn(db: Db): Promise<NextResponse | null> {
  const gameState = await db.collection<GameState>("gameState").findOne(
    { _id: "current" },
    {
      projection: {
        isProcessing: 1,
        processingHeartbeatAt: 1,
        processingStartedAt: 1,
        updatedAt: 1,
      },
    }
  );

  if (!gameState || !isTurnProcessingNow(gameState)) return null;

  return NextResponse.json(
    { error: "The game is processing this turn, try again shortly." },
    { status: 409 }
  );
}
