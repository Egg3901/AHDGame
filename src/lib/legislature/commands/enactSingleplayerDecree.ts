import type { Bill } from "@/lib/db/types";
import { applyEnactedBillEffects } from "@/lib/legislature/commands/applyEnactedBillEffects";
import { getGameState } from "@/lib/gameState";
import type { Db } from "mongodb";
import { captureBillStatusChanged } from "@/lib/analytics/billStatusAnalytics";
import { flushServerPosthog } from "@/lib/analytics/serverPosthog";

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
  const turn = (await getGameState(db))?.currentTurn ?? 0;
  await captureBillStatusChanged({
    db,
    billId: bill._id.toString(),
    fromStatus: "active",
    toStatus: "signed",
    scope: "national",
    chamber: bill.currentChamber ?? bill.originChamber,
    category: bill.category,
    provisionFamily: bill.provisions?.[0]?.type,
    nationId: bill.countryId ?? "US",
    turn,
  });
  await applyEnactedBillEffects(db, enacted, turn, {
    effect: "Singleplayer decree effect failed:",
    enactment: "Singleplayer decree enactment hook failed:",
  });
  await flushServerPosthog();
  return true;
}
