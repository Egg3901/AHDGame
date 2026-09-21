// src/lib/turn/npp/capacityWriteback.ts
/**
 * Cohort capacity write-back for NPP corporation turns.
 *
 * Everything the cohort writes about capacity after deciding: capex ledger
 * legs for reinvestment builds, in-memory depletion of the unowned pools later
 * corps in the pass still see, founded-sector inserts, the founded-capacity
 * drawdown against the pool collection, and the bulk flushes. Pure
 * construction except for the final bulk writes, which issue the same ops the
 * shell used to issue inline.
 */
import { ObjectId, type Db } from "mongodb";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import type { UnownedSector } from "@/lib/db/types/unownedSector";
import type { CountryId } from "@/lib/constants/countries";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { emitBuildCapexTxBulk, type BuildCapexTxInput } from "@/lib/corporations/capexTxLog";
import {
  unownedHeadroomBaseExpr,
  unownedHeadroomUnitsPerAnchor,
  unownedPoolTrailingSet,
} from "@/lib/market/unownedHeadroom";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { bucketKey } from "@/lib/nationalization/stateControlledBuckets";
import {
  persistNppMarketEntryFunnelBestEffort,
  type NppMarketEntryDiagnostic,
} from "@/lib/turn/npp/entryDiagnostics";
import { recordCapacityDecisionBulkBestEffort } from "@/lib/corporations/capacityDecisionTelemetry/persistence";
import type { CapacityDecisionObservation } from "@/lib/corporations/capacityDecisionTelemetry/rules";
import type { NppOperatorObservation } from "@/lib/corporations/nppOperatorTelemetry/rules";
import { recordNppOperatorObservationsBestEffort } from "@/lib/corporations/nppOperatorTelemetry/persistence";
import type { NppCorpDecision } from "@/lib/turn/npp/corpDecisionTypes";

export type NppReinvestmentList = NonNullable<NppCorpDecision["reinvestments"]>;
export type NppUnownedDrawList = NonNullable<NppCorpDecision["unownedDraws"]>;
export type NppNewSectorList = NonNullable<NppCorpDecision["newSectors"]>;

/**
 * Capex ledger legs for NPP capacity reinvestment. A build is a cash-to-CIP
 * reclass, and the shadow ledger drops rows with no anchor value, so every
 * row carries both the local and anchor magnitude.
 */
export function appendNppReinvestCapexRows(
  rows: BuildCapexTxInput[],
  args: {
    corp: Pick<Corporation, "_id" | "name" | "sequentialId">;
    corpCurrency: CurrencyCode;
    reinvestments: NppReinvestmentList;
    turn: number;
    now: Date;
  }
): void {
  for (const r of args.reinvestments) {
    rows.push({
      corporationId: args.corp._id,
      corporationName: args.corp.name ?? "NPP corporation",
      corporationSequentialId: args.corp.sequentialId,
      direction: "build",
      amountLocal: Math.abs(r.costLocal),
      currencyCode: args.corpCurrency,
      anchorAmount: Math.abs(r.costAnchor),
      turn: args.turn,
      createdAt: args.now,
      sectorId: r.sectorId,
      sectorType: r.sectorType,
      units: r.units,
      meta: { source: "npp_reinvestment", onlineTurn: r.onlineTurn },
    });
  }
}

/**
 * Deplete the in-memory pool BEFORE the next corp decides. The snapshot is
 * shared across the pass, so without this every corp that picks the same
 * bucket sizes off the same pre-draw pool and mints capacity the drawdown
 * below clamps at 0. Units lead, `revenue` derives from the same quantity.
 */
export function depleteUnownedPoolsForDraws(
  unownedIndex: Map<string, UnownedSector>,
  draws: NppUnownedDrawList,
  eraUnitScale: number
): void {
  for (const draw of draws) {
    const pool = unownedIndex.get(bucketKey(draw.stateId, draw.sectorType));
    if (!pool) continue;
    const unitsPerAnchor = unownedHeadroomUnitsPerAnchor(draw.sectorType, eraUnitScale);
    const remaining = Math.max(
      0,
      unownedHeadroomUnitsOf(draw.sectorType, pool.headroomUnits, pool.revenue, eraUnitScale) -
        draw.units
    );
    pool.headroomUnits = remaining;
    pool.revenue = unitsPerAnchor > 0 ? Math.round(remaining / unitsPerAnchor) : pool.revenue;
  }
}

export type NppFoundedSectorInsert = Omit<CorporateSector, "_id"> & { _id: ObjectId };

/**
 * Founded-sector inserts for this corp's entries. Plants births grow via build
 * orders, never via the growth slider, and carry the same shape
 * `expandSector` gives a player's new sector.
 */
export function buildNppFoundedSectorInserts(args: {
  corporationId: ObjectId;
  newSectors: NppNewSectorList;
  blocked: ReadonlySet<CountryId>;
  turn: number;
  now: Date;
}): NppFoundedSectorInsert[] {
  const inserts: NppFoundedSectorInsert[] = [];
  for (const ns of args.newSectors) {
    if (args.blocked.has(ns.countryId as CountryId)) continue; // belt and braces
    inserts.push({
      _id: new ObjectId(),
      corporationId: args.corporationId,
      countryId: ns.countryId as CountryId,
      stateId: ns.stateId,
      sectorType: ns.sectorType,
      targetGrowthRate: ns.starterOrder ? 0 : 2,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      revenue: ns.revenue,
      profitMargin: ns.profitMargin,
      ...(ns.strategyId ? { strategyId: ns.strategyId } : {}),
      workers: 100,
      createdAt: args.now,
      updatedAt: args.now,
      ...(ns.starterOrder
        ? {
            capitalStock: 0,
            buildQueue: [ns.starterOrder],
            constructionInProgressAnchor: Math.round(ns.starterOrder.costPaidAnchor),
            plantsStartTurn: args.turn,
          }
        : {}),
    });
  }
  return inserts;
}

/**
 * Draw founded capacity out of the unowned pools. A founding consumes market
 * headroom; leaving the pool intact counts the same demand twice (owned
 * capacity AND unowned headroom). Pipeline update so `headroomUnits` and the
 * legacy `revenue` view move in lockstep; both clamp at 0. Buckets with no
 * pool doc upsert the scaffold rather than discarding the draw.
 */
export async function drawFoundedCapacityFromPools(
  db: Db,
  draws: NppUnownedDrawList,
  args: { eraUnitScale: number; now: Date }
): Promise<void> {
  if (draws.length === 0) return;
  await db.collection<UnownedSector>("unownedSectors").bulkWrite(
    draws.map(({ stateId, sectorType, units, countryId }) => {
      return {
        updateOne: {
          filter: { stateId, sectorType },
          update: [
            {
              $set: {
                stateId: { $ifNull: ["$stateId", stateId] },
                countryId: { $ifNull: ["$countryId", countryId] },
                sectorType: { $ifNull: ["$sectorType", sectorType] },
                createdAt: { $ifNull: ["$createdAt", args.now] },
                headroomUnits: {
                  // Self-healing base, NOT a bare `$ifNull: [..., 0]`: a pool
                  // doc that predates the backfill would otherwise be wiped to
                  // zero by its own first drawdown. See
                  // `unownedHeadroomBaseExpr`.
                  $max: [
                    0,
                    {
                      $subtract: [unownedHeadroomBaseExpr(sectorType, args.eraUnitScale), units],
                    },
                  ],
                },
                updatedAt: args.now,
              },
            },
            // Restate `revenue` FROM the post-draw units instead of subtracting
            // from it independently; the shared trailing stage keeps the two
            // clamped-at-0 legs one quantity in two units.
            { $set: unownedPoolTrailingSet(sectorType, true, args.eraUnitScale) },
          ],
          upsert: true,
        },
      };
    })
  );
}

/**
 * Cohort flushes: capex ledger, market-entry funnel, then the aggregated
 * capacity-decision observations. Same ops, same order as the inline shell.
 */
export async function flushNppCapacityWriteback(
  db: Db,
  args: {
    turn: number;
    now: Date;
    entryDiagnostics: NppMarketEntryDiagnostic[];
    capexRows: BuildCapexTxInput[];
    capacityObservations: readonly CapacityDecisionObservation[];
    operatorObservations: readonly NppOperatorObservation[];
  }
): Promise<void> {
  if (args.capexRows.length > 0) {
    await emitBuildCapexTxBulk(db, args.capexRows);
  }
  await persistNppMarketEntryFunnelBestEffort(db, args.turn, args.now, args.entryDiagnostics);
  await recordCapacityDecisionBulkBestEffort(db, args.turn, args.capacityObservations);
  await recordNppOperatorObservationsBestEffort(db, args.turn, args.now, args.operatorObservations);
}
