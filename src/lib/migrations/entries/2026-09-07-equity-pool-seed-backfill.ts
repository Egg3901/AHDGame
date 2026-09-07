import type { Db } from "mongodb";
import type { EquityMarketPool } from "@/lib/db/types/equityMarketPool";
import { EQUITY_MARKET_POOLS_COLLECTION } from "@/lib/db/types/equityMarketPool";
import { poolConservationResidual } from "@/lib/equities/poolConservation";
import type { Migration, MigrationContext, MigrationResult } from "../types";

/**
 * Record each equity market pool's opening balance as `seedLocal`.
 *
 * The pools were inserted at `m2 x EQUITY_POOL_M2_SHARE` with no ledger counter
 * for that opening balance, so today the conservation identity cannot be
 * evaluated at all: there is no way to distinguish the ~41.5B USD the pool
 * STARTED with from the ~22.0B it later created out of nothing. Without this
 * field `poolConservationResidual` can only return NaN on live data.
 *
 * ─── THE DELIBERATE ASYMMETRY ───────────────────────────────────────────────
 * {@link inferSeedLocal} DOES count `inflowIn`, because it reconstructs history
 * as it actually happened: the pool really did receive that cash, however
 * improperly. `poolConservationResidual` does NOT count it, because it measures
 * what the pool was ENTITLED to.
 *
 * Backfilling with `inferSeedLocal` therefore leaves each pool reading a
 * residual of exactly its lifetime `inflowIn` — the amount already minted. That
 * is the correct and honest starting reading, not a bug: the money was created,
 * the counter should say so, and the per-turn warning will keep saying so until
 * somebody decides what to do about the historical mint. It does not grow,
 * because the inflow leg is gone.
 *
 * Idempotent: pools that already carry `seedLocal` are skipped.
 */
export function inferSeedLocal(pool: EquityMarketPool): number {
  const l = pool.lifetime ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const netFlows =
    n(l.purchasesIn) +
    n(l.dividendsIn) +
    n(l.inflowIn) -
    n(l.salesOut) -
    n(l.issuanceOut) -
    n(l.sweepOut);
  const cash = Number.isFinite(pool.cashLocal) ? pool.cashLocal : 0;
  // A pool cannot have been seeded with negative cash. Clamping at 0 keeps a
  // malformed ledger from writing a nonsense seed that would then read as a
  // permanent conservation surplus.
  return Math.max(0, cash - netFlows);
}

async function backfillEquityPoolSeed(db: Db, ctx: MigrationContext): Promise<MigrationResult> {
  const pools = await db
    .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
    .find({})
    .toArray();

  const notes: string[] = [];
  let updated = 0;
  let alreadySeeded = 0;

  for (const pool of pools) {
    if (typeof pool.seedLocal === "number" && Number.isFinite(pool.seedLocal)) {
      alreadySeeded++;
      continue;
    }
    const seedLocal = inferSeedLocal(pool);
    const residual = poolConservationResidual({ ...pool, seedLocal });
    notes.push(
      `${pool._id}: cash ${pool.cashLocal.toFixed(2)} seed ${seedLocal.toFixed(2)} ` +
        `residual ${residual.toFixed(2)} (minted ${(pool.lifetime?.inflowIn ?? 0).toFixed(2)})`
    );
    if (!ctx.dryRun) {
      await db
        .collection<EquityMarketPool>(EQUITY_MARKET_POOLS_COLLECTION)
        .updateOne({ _id: pool._id }, { $set: { seedLocal, updatedAt: new Date() } });
    }
    updated++;
  }

  notes.unshift(
    `${ctx.dryRun ? "DRY RUN, no writes. " : ""}${pools.length} pools; ` +
      `${updated} backfilled, ${alreadySeeded} already had a seed`
  );

  return {
    documentsScanned: pools.length,
    documentsUpdated: ctx.dryRun ? 0 : updated,
    notes,
  };
}

export const migration: Migration = {
  id: "2026-09-07-equity-pool-seed-backfill",
  description: "Record each equity market pool's opening balance as seedLocal",
  idempotent: true,
  execute: backfillEquityPoolSeed,
};
