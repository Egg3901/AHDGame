import { NextResponse } from "next/server";
import type { Db } from "mongodb";
import { getGameStateCollection } from "@/lib/db/collections";
import { errorResponse } from "@/lib/api/errors";

/**
 * Gate for the corporate M&A / acquisitions subsystem. Returns a 403 NextResponse
 * when the `corpDealsEnabled` game flag is off (the default), else null. Mirrors
 * `requireCorporationActionsEnabled`.
 */
export async function requireCorpDealsEnabled(db: Db): Promise<NextResponse | null> {
  const col = await getGameStateCollection(db);
  const gameState = await col.findOne({ _id: "current" }, { projection: { corpDealsEnabled: 1 } });
  if (!gameState?.corpDealsEnabled) {
    return errorResponse(403, "Corporate acquisitions are not currently enabled.");
  }
  return null;
}
