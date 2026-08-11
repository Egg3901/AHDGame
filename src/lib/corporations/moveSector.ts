import type { Db, ObjectId } from "mongodb";
import type { CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import type { CorporationType } from "@/lib/constants/corporations";
import {
  capacityRescaleRatio,
  rescaleBuildQueueForStrategyChange,
} from "@/lib/constants/capacityEconomy";
import type { SectorBuildOrder } from "@/lib/db/types";
// CIP source of truth: the DENORMALIZED `constructionInProgressAnchor`, which
// is what `mergeSectorPlantFields` sums and what every other consumer reads.
// `sectorTurn` rewrites it from the post-landing queue every turn, so the two
// agree by construction; recomputing from the queue here (as this file used to)
// silently disagreed with the shared helper for any row whose two had drifted,
// and made a merge quietly "heal" a drifted row on one path only.
import { mergeSectorPlantFields } from "@/lib/corporations/sectorTransferCapex";

/**
 * Move one operating sector to `destCorpId`, re-denominating its revenue + growth
 * cost from the source corp's home currency to the destination's (sector economic
 * fields are stored in the owner's currency post-v0.2.6).
 *
 * Respects the unique (corporationId, stateId, sectorType) index: if the
 * destination already operates that (state, type), the donor is MERGED in (its
 * capacity folded, donor row dropped); otherwise it is re-parented. Haircut-free
 * — unlike nationalization's absorbSectorIntoNatCorp, this is a consensual
 * transfer, not a taking, so no productivity shock is applied.
 */
export async function moveSectorToCorp(
  db: Db,
  sector: CorporateSector,
  destCorpId: ObjectId,
  srcCurrency: CurrencyCode | string | undefined,
  srcFxRate: number,
  destCurrency: CurrencyCode | string | undefined,
  destFxRate: number,
  now: Date
): Promise<void> {
  const sectors = db.collection<CorporateSector>("corporateSectors");
  const revenueAnchor = readCorpEconomicAnchor(sector.revenue ?? 0, srcCurrency, srcFxRate);
  const growthCostAnchor = readCorpEconomicAnchor(
    sector.currentGrowthCost ?? 0,
    srcCurrency,
    srcFxRate
  );
  const newRevenue = Math.round(writeCorpEconomicLocal(revenueAnchor, destCurrency, destFxRate));
  const newGrowthCost = Math.round(
    writeCorpEconomicLocal(growthCostAnchor, destCurrency, destFxRate)
  );

  const existing = await sectors.findOne({
    corporationId: destCorpId,
    stateId: sector.stateId,
    sectorType: sector.sectorType,
  });

  // Under plants, `revenue` is restated from `capitalStock × mixPrice` by the
  // turn processor every turn, so it is a DERIVED field on both sides of this
  // move. Merging it would double-count the donor's capacity for one turn
  // (capacity folded in AND revenue added on top) before being overwritten, and
  // re-denominating it on the re-parent branch buys nothing — the restatement
  // writes it in the sector's HOST currency next tick regardless of who owns
  // the row. So under plants the quantity that moves is capacity: `capitalStock`
  // (nameplate-invariant across a strategy difference, D9), the in-flight
  // `buildQueue` (units rescaled by the same ratio) and its CIP anchor.
  const plantsEnabled = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  if (existing && !existing._id.equals(sector._id)) {
    if (plantsEnabled) {
      const ratio = capacityRescaleRatio(
        sector.sectorType as CorporationType,
        sector.strategyId,
        existing.strategyId
      );
      const donorStock =
        typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
          ? Math.max(0, sector.capitalStock)
          : 0;
      const donorQueue: SectorBuildOrder[] = Array.isArray(sector.buildQueue)
        ? rescaleBuildQueueForStrategyChange(sector.buildQueue, ratio)
        : [];
      // The strategy-ratio rescale is the only thing special about THIS merge
      // path; everything after it is the shared fold. Pre-fix this file
      // hand-rolled the fold and diverged from `mergeSectorPlantFields` on
      // three points, all of them silent: the merged queue was not re-sorted by
      // `onlineTurn` (the turn processor's "land everything due" scan depends
      // on that ordering), `plantsStartTurn` was dropped instead of taking the
      // earlier of the two (restarting the survivor's governor ramp), and
      // `mothballed` was not merged at all (a move into a mothballed survivor
      // left it idle while holding the donor's capacity).
      //
      // `costPaidAnchor` is ₳-anchored cash ALREADY SPENT and is deliberately
      // not rescaled by the strategy ratio (same rule as the retool path) — CIP
      // and the cancellation refund must keep reporting what was actually paid,
      // which is why the rescale above touches units only.
      const merged = mergeSectorPlantFields(
        {
          capitalStock: existing.capitalStock,
          buildQueue: existing.buildQueue,
          constructionInProgressAnchor: existing.constructionInProgressAnchor,
          mothballed: existing.mothballed,
          plantsStartTurn: existing.plantsStartTurn,
          legacyRevenueShadow: existing.legacyRevenueShadow,
        },
        {
          capitalStock: Math.round(donorStock * ratio * 100) / 100,
          buildQueue: donorQueue,
          constructionInProgressAnchor: sector.constructionInProgressAnchor,
          mothballed: sector.mothballed,
          plantsStartTurn: sector.plantsStartTurn,
          legacyRevenueShadow: sector.legacyRevenueShadow,
        }
      );
      await sectors.updateOne(
        { _id: existing._id },
        {
          // Workers are recomputed from capacity next turn under plants, so the
          // headcount merge is informational only — kept so the row is not
          // visibly wrong between now and the next tick.
          $inc: {
            workers: sector.workers ?? 0,
            currentGrowthCost: newGrowthCost,
          },
          $set: {
            ...merged,
            constructionInProgressAnchor: Math.round(merged.constructionInProgressAnchor),
            updatedAt: now,
          },
        }
      );
      await sectors.deleteOne({ _id: sector._id });
      return;
    }
    await sectors.updateOne(
      { _id: existing._id },
      {
        $inc: {
          // PLANTS-GATED: unreachable under plants — the branch above returns
          // first. Below plants the nameplate IS the state, so it merges.
          revenue: newRevenue,
          workers: sector.workers ?? 0,
          currentGrowthCost: newGrowthCost,
        },
        $set: { updatedAt: now },
      }
    );
    await sectors.deleteOne({ _id: sector._id });
  } else {
    await sectors.updateOne(
      { _id: sector._id },
      {
        $set: {
          corporationId: destCorpId,
          ...(plantsEnabled ? {} : { revenue: newRevenue }),
          currentGrowthCost: newGrowthCost,
          updatedAt: now,
        },
        $unset: { forSale: "" },
      }
    );
  }
}
