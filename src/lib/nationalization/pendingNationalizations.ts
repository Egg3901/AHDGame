/**
 * Resolve pending nationalizations whose notice window has elapsed (spec §14).
 * Re-checks the cited strategic/monopoly conditions: if every cited curable
 * condition has cleared, cancel (the player cured it); otherwise complete via
 * the Phase-1 transition. Targets that vanished / went state-owned cancel as a
 * no-op. Mirrors the `processVoteAutoResolve` sweep; called from the corp turn.
 */
import type { Db } from "mongodb";
import type { Corporation, CorporateSector, PendingNationalization } from "@/lib/db/types";
import { createNotification } from "@/lib/notifications";
import { isStateOwned } from "./nationalCorporation";
import { nationalizeSector, nationalizeWholeCorp } from "./ownershipTransition";
import { getDesignatedSectorTypes, corpHasStrategicSector } from "./strategicSectors";
import { getTopMarketSharePercent } from "./monopolyTrigger";
import { allCitedConditionsCleared } from "./noticeWindow";
import { MONOPOLY_SHARE_THRESHOLD } from "./constants";

export async function processPendingNationalizations(
  db: Db,
  currentTurn: number
): Promise<{ completed: number; cancelled: number }> {
  const coll = db.collection<PendingNationalization>("pendingNationalizations");
  const due = await coll
    .find({ status: "pending", noticeDeadlineTurn: { $lte: currentTurn } })
    .toArray();

  let completed = 0;
  let cancelled = 0;

  for (const pending of due) {
    try {
      const r = await resolveOne(db, pending, currentTurn);
      if (r === "completed") completed++;
      else cancelled++;
    } catch (err) {
      // Isolate failures (e.g. a fair-tier taking the treasury cannot afford):
      // leave the pending in place to retry next turn rather than aborting the
      // whole sweep / corp turn. Mirrors the per-item resilience of the vote sweep.
      console.error(
        `[pendingNationalization] failed to resolve ${pending._id.toString()}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return { completed, cancelled };
}

/** Resolve a single due pending taking; throws are caught by the caller. */
async function resolveOne(
  db: Db,
  pending: PendingNationalization,
  currentTurn: number
): Promise<"completed" | "cancelled"> {
  const coll = db.collection<PendingNationalization>("pendingNationalizations");

  const cancel = async (notify: boolean, corp?: Corporation | null): Promise<"cancelled"> => {
    await coll.updateOne(
      { _id: pending._id },
      { $set: { status: "cancelled", resolvedAtTurn: currentTurn } }
    );
    if (notify && corp?.userId) {
      await createNotification({
        userId: corp.userId,
        type: "corp_nationalization_cancelled",
        title: "Nationalization averted",
        message: `${corp.name} is no longer being nationalized — the conditions were cleared.`,
        metadata: { corporationId: corp._id.toString() },
      });
    }
    return "cancelled";
  };

  // Resolve the target corp (directly or via the sector).
  let corp: Corporation | null = null;
  let sector: CorporateSector | null = null;
  if (pending.targetSectorId) {
    sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: pending.targetSectorId });
    if (sector)
      corp = await db
        .collection<Corporation>("corporations")
        .findOne({ _id: sector.corporationId });
  } else if (pending.targetCorporationId) {
    corp = await db
      .collection<Corporation>("corporations")
      .findOne({ _id: pending.targetCorporationId });
  }

  // Target gone / already state-owned ⇒ cancel as a no-op.
  if (!corp || isStateOwned(corp)) return cancel(false);

  // Cure path: avert the taking if the owner cleared the cited cause during the
  // notice window. This applies ONLY to automatic executive/regulatory takings.
  // A legislative taking is a deliberate act of the legislature and completes
  // regardless — its cited triggers are political framing recorded at enactment,
  // not a live condition the owner can satisfy to escape a passed bill. (Without
  // this carve-out, a corp that merely shrank below the monopoly threshold after
  // the bill passed — e.g. via a vacant-CEO revenue collapse — would dodge a
  // nationalization the legislature already voted through.)
  if (pending.method !== "legislative") {
    // Re-check the cited curable conditions.
    const corpSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corp._id })
      .toArray();
    const designated = await getDesignatedSectorTypes(db, pending.countryId);
    const strategicActive = corpHasStrategicSector(designated, pending.countryId, corpSectors);
    const topShare = await getTopMarketSharePercent(db, corp, corpSectors);
    const monopolyActive = topShare >= MONOPOLY_SHARE_THRESHOLD * 100;

    if (
      allCitedConditionsCleared(pending.triggers, {
        strategic: strategicActive,
        monopoly: monopolyActive,
      })
    ) {
      return cancel(true, corp);
    }
  }

  // Complete the taking via the Phase-1 transition (same consequence context).
  const consequence = {
    method: pending.method,
    triggers: pending.triggers,
    turn: currentTurn,
    governingPartyId: pending.governingPartyId,
  };
  if (pending.targetSectorId && sector) {
    await nationalizeSector(db, {
      countryId: pending.countryId,
      sectorId: sector._id,
      tier: pending.tier,
      consequence,
    });
  } else {
    await nationalizeWholeCorp(db, {
      countryId: pending.countryId,
      corporationId: corp._id,
      tier: pending.tier,
      consequence,
    });
  }
  await coll.updateOne(
    { _id: pending._id },
    { $set: { status: "completed", resolvedAtTurn: currentTurn } }
  );
  return "completed";
}
