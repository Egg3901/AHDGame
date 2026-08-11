import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";

export async function requirePlayerTransfersEnabled(db: Db): Promise<NextResponse | null> {
  const col = await getGameStateCollection(db);
  const gameState = await col.findOne(
    { _id: "current" },
    { projection: { playerTransfersPaused: 1 } }
  );

  if (gameState?.playerTransfersPaused) {
    return NextResponse.json(
      {
        error: "Player-to-player transfers are currently paused by an admin",
      },
      { status: 403 }
    );
  }

  return null;
}
