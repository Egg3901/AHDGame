import type { AnyBulkWriteOperation, Db, ObjectId, UpdateFilter } from "mongodb";
import type { IndexFund, IndexFundPosition } from "@/lib/db/types";
import { INDEX_FUND_INITIAL_NAV } from "@/lib/indexFunds/unitAccounting";
import type { Migration, MigrationContext, MigrationResult } from "../types";

type FundState = Pick<
  IndexFund,
  | "_id"
  | "reserveUnits"
  | "unitSupply"
  | "holdings"
  | "targetConstituents"
  | "listingFailureStreaks"
  | "updatedAt"
>;

/**
 * Remove references to corporations that no longer exist and reconcile each
 * fund's unitSupply to its position ledger.
 *
 * The reset manifest used to preserve `indexFunds` as reference data while it
 * wiped corporations and every indexFund* runtime collection. That retained
 * old-world holdings and unit supply but deleted both their corporations and
 * holder positions. The current world then accumulated new positions on top.
 *
 * Holdings are removed with `$pull` and supply is repaired with `$inc`, so a
 * subscription or redemption racing the migration keeps its own atomic delta.
 */
async function repairOrphanIndexFundState(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const liveCorporations = await db
    .collection<{ _id: ObjectId }>("corporations")
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const liveIds = new Set(liveCorporations.map((corporation) => corporation._id.toString()));

  const funds = await db
    .collection<FundState>("indexFunds")
    .find(
      {},
      {
        projection: {
          _id: 1,
          reserveUnits: 1,
          unitSupply: 1,
          holdings: 1,
          targetConstituents: 1,
          listingFailureStreaks: 1,
        },
      }
    )
    .toArray();
  if (
    liveCorporations.length === 0 &&
    funds.some(
      (fund) => (fund.holdings?.length ?? 0) > 0 || (fund.targetConstituents?.length ?? 0) > 0
    )
  ) {
    throw new Error(
      "Refusing index-fund orphan repair while corporations is empty but funds still reference corporations"
    );
  }
  const fundIds = funds.map((fund) => fund._id);
  const positions = fundIds.length
    ? await db
        .collection<IndexFundPosition>("indexFundPositions")
        .find({ fundId: { $in: fundIds } }, { projection: { fundId: 1, holderKind: 1, units: 1 } })
        .toArray()
    : [];

  const positionUnitsByFund = new Map<string, number>();
  const fundsWithReserve = new Set<string>();
  for (const position of positions) {
    const key = position.fundId.toString();
    positionUnitsByFund.set(
      key,
      (positionUnitsByFund.get(key) ?? 0) + Math.max(0, Math.floor(position.units ?? 0))
    );
    if (position.holderKind === "fund_reserve") fundsWithReserve.add(key);
  }

  const now = new Date();
  const reserveOps: AnyBulkWriteOperation<IndexFundPosition>[] = [];
  const fundOps: AnyBulkWriteOperation<FundState>[] = [];
  let orphanHoldings = 0;
  let orphanTargets = 0;
  let orphanStreaks = 0;
  let staleValueAnchor = 0;
  let supplyRepairs = 0;

  for (const fund of funds) {
    const fundKey = fund._id.toString();
    let positionUnits = positionUnitsByFund.get(fundKey) ?? 0;
    const seedReserveUnits = Math.max(0, Math.floor(fund.reserveUnits ?? 0));
    if (!fundsWithReserve.has(fundKey) && seedReserveUnits > 0) {
      reserveOps.push({
        updateOne: {
          filter: { fundId: fund._id, holderKind: "fund_reserve" },
          update: {
            $setOnInsert: {
              fundId: fund._id,
              holderKind: "fund_reserve",
              units: seedReserveUnits,
              avgNavAnchor: INDEX_FUND_INITIAL_NAV,
              createdAt: now,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      });
      positionUnits += seedReserveUnits;
    }

    const deadHoldingIds = (fund.holdings ?? [])
      .filter((holding) => !liveIds.has(holding.corporationId.toString()))
      .map((holding) => holding.corporationId);
    const deadTargetIds = (fund.targetConstituents ?? [])
      .filter((target) => !liveIds.has(target.corporationId.toString()))
      .map((target) => target.corporationId);
    const deadStreakIds = (fund.listingFailureStreaks ?? [])
      .filter((streak) => !liveIds.has(streak.corporationId.toString()))
      .map((streak) => streak.corporationId);
    const supplyDelta = positionUnits - Math.max(0, Math.floor(fund.unitSupply ?? 0));

    orphanHoldings += deadHoldingIds.length;
    orphanTargets += deadTargetIds.length;
    orphanStreaks += deadStreakIds.length;
    staleValueAnchor += (fund.holdings ?? [])
      .filter((holding) => !liveIds.has(holding.corporationId.toString()))
      .reduce((sum, holding) => sum + Math.max(0, holding.lastValueAnchor ?? 0), 0);
    if (supplyDelta !== 0) supplyRepairs++;

    if (
      deadHoldingIds.length === 0 &&
      deadTargetIds.length === 0 &&
      deadStreakIds.length === 0 &&
      supplyDelta === 0
    ) {
      continue;
    }

    const update: UpdateFilter<FundState> = { $set: { updatedAt: now } };
    if (supplyDelta !== 0) update.$inc = { unitSupply: supplyDelta };
    const pull: Record<string, unknown> = {};
    if (deadHoldingIds.length > 0) {
      pull.holdings = { corporationId: { $in: deadHoldingIds } };
    }
    if (deadTargetIds.length > 0) {
      pull.targetConstituents = { corporationId: { $in: deadTargetIds } };
    }
    if (deadStreakIds.length > 0) {
      pull.listingFailureStreaks = { corporationId: { $in: deadStreakIds } };
    }
    if (Object.keys(pull).length > 0) update.$pull = pull as never;
    fundOps.push({ updateOne: { filter: { _id: fund._id }, update } });
  }

  const action = ctx.dryRun ? "would repair" : "repaired";
  const notes = [
    `${action} ${fundOps.length} fund${fundOps.length === 1 ? "" : "s"}: ` +
      `${orphanHoldings} orphan holding${orphanHoldings === 1 ? "" : "s"}, ` +
      `${orphanTargets} orphan target${orphanTargets === 1 ? "" : "s"}, ` +
      `${orphanStreaks} orphan listing streak${orphanStreaks === 1 ? "" : "s"}, ` +
      `${supplyRepairs} unit-supply reconciliation${supplyRepairs === 1 ? "" : "s"}, ` +
      `${Math.round(staleValueAnchor).toLocaleString("en-US")} stale anchor value removed`,
    `${ctx.dryRun ? "would recreate" : "recreated"} ${reserveOps.length} missing seeded reserve position${reserveOps.length === 1 ? "" : "s"}`,
  ];

  if (ctx.dryRun) {
    return { documentsScanned: funds.length, documentsUpdated: 0, notes };
  }

  if (reserveOps.length > 0) {
    await db.collection<IndexFundPosition>("indexFundPositions").bulkWrite(reserveOps);
  }
  let updated = 0;
  if (fundOps.length > 0) {
    const result = await db.collection<FundState>("indexFunds").bulkWrite(fundOps);
    updated = result.modifiedCount;
  }
  return { documentsScanned: funds.length, documentsUpdated: updated, notes };
}

export const migration: Migration = {
  id: "2026-09-03-repair-orphan-index-fund-state",
  description:
    "Remove old-world index-fund corporation references and reconcile unit supply to positions.",
  idempotent: true,
  execute: repairOrphanIndexFundState,
};
