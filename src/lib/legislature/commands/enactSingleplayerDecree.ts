import type { Bill } from "@/lib/db/types";
import { onBillEnacted } from "@/lib/billEnactment";
import { applyLegislationEffect } from "@/lib/legislationEffects";
import { getGameState } from "@/lib/gameState";
import type { Db } from "mongodb";

/**
 * Enact a newly validated bill for permanent head-of-state singleplayer.
 * Eligibility is proved by the caller. The atomic status claim keeps normal
 * multiplayer lifecycle workers from applying the same law twice.
 */
export async function enactSingleplayerDecree(db: Db, bill: Bill): Promise<boolean> {
  const now = new Date();
  const claimed = await db.collection<Bill>("bills").updateOne(
    { _id: bill._id, status: "active" },
    {
      $set: {
        status: "signed",
        presidentAction: "signed",
        presidentActionAt: now,
        enactedAt: now,
        updatedAt: now,
      },
    }
  );
  if (claimed.modifiedCount !== 1) return false;
  const enacted = { ...bill, status: "signed", presidentAction: "signed", enactedAt: now } as Bill;
  await applyLegislationEffect(db, enacted).catch((error) =>
    console.error("Singleplayer decree effect failed:", error)
  );
  const turn = (await getGameState(db))?.currentTurn ?? 0;
  await onBillEnacted(db, enacted, turn).catch((error) =>
    console.error("Singleplayer decree enactment hook failed:", error)
  );
  return true;
}
