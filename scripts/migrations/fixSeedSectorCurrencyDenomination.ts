/**
 * Backfill: re-denominate SEED-SPAWNED corporate sectors whose `revenue` was
 * written in ₳ (anchor) instead of the sector's HOST-STATE currency.
 *
 * ─── THE BUG ──────────────────────────────────────────────────────────────
 * `corporateSectors.revenue` is stored in the sector's host-state currency —
 * readers call `readCorpEconomicAnchor` (local → ₳), writers
 * `writeCorpEconomicLocal` (₳ → local); see `src/lib/currency/corpEconomyFields.ts`.
 *
 * `spawnNppCorporation` skipped that conversion. Its `startingRevenue` is
 * ₳-native (it comes from `unownedSectors.revenue`, which is ₳ by documented
 * convention, or from `computeUnownedSeedRevenue`, or from the ₳ constant
 * `DEFAULT_SECTOR_STARTING_REVENUE`) and it was written straight into the
 * sector row. Every reader then divides by the host FX rate a second time, so
 * the sector contributes 1/fx of its true weight to EVERY ₳-denominated
 * aggregate: tax rollups, GDP weighting, market-share denominators, credit
 * ratings, corp valuation.
 *
 * The two sibling seed paths were already correct and are NOT touched here:
 * `incrementNatCorpSectorRevenue` (seedToNatCorp.ts) and `expandSector` both
 * convert at the boundary. `autoSectorSeed` only writes `unownedSectors`
 * (₳-native, correct) and applies a scale-free multiplier to corporate rows
 * (denomination-neutral, correct).
 *
 * ─── THE HEAL ─────────────────────────────────────────────────────────────
 *     newStored = storedNow × fxHost
 *
 * The stored value is the ₳ figure sitting in a local-currency field.
 * Multiplying by the host rate puts the SAME ₳ amount into the field's actual
 * denomination. This survives arbitrary post-seed growth: the turn processor's
 * read (÷fx) → grow → write (×fx) cycle is denomination-preserving, so a row
 * that started ₳-denominated is still ₳-denominated however far it has grown,
 * and one multiplication corrects it exactly. Same argument as the earlier
 * `heal-sector-revenue-anchor-bug.ts`.
 *
 * ─── DETECTION (provenance, not magnitude) ────────────────────────────────
 * A magnitude heuristic cannot tell a correctly-denominated small sector from
 * a mis-denominated one — that was the weak point of the earlier heal, which
 * needed a peer median and punted on thin markets. This migration instead
 * identifies the exact rows the buggy writer produced:
 *
 *   1. the owning corp has `ceoType === "npp"`      (only spawn path affected)
 *   2. `sector.stateId === corp.headquartersState`  (the FOUNDING sector…)
 *   3. `sector.sectorType === corp.type`            (…which spawn always makes)
 *   4. `|sector.createdAt − corp.createdAt| ≤ 2s`   (created in the same call)
 *
 * Conditions 2–4 exclude sectors the same NPP corp later acquired through
 * `expandSector`, attacks, or takeovers — all of which denominate correctly.
 * Validated against the `ab3_capital` sim world: 408/408 NPP corps matched
 * exactly one founding sector, every one within 1 second of the corp doc, and
 * the matched population's mean stored revenue was ~1.2e6 in EVERY country
 * regardless of FX rate (the ₳ signature), while unmatched rows scaled with
 * the rate as they should.
 *
 * HONEST LIMITATIONS — read before running:
 *   • It is provenance, not proof. A world where an operator hand-edited a
 *     founding sector's revenue into the correct denomination would be
 *     double-scaled by this migration. There is no marker on the row itself to
 *     rule that out; if such edits happened, run with `--dry-run` and check the
 *     per-country table against expectations first.
 *   • Corps spawned by `spawnNppCorporation` AFTER the writer fix in this same
 *     change are already correct — and are indistinguishable from pre-fix ones
 *     by provenance alone. This migration must therefore be run BEFORE (or in
 *     the same deploy as) the fixed code reaches a world that keeps spawning
 *     NPP corps. The marker makes it one-shot, so a world that deploys the fix
 *     and the migration together is consistent; a world that deploys the fix,
 *     spawns corps for weeks, and only then runs the migration would re-break
 *     the new ones. Stated plainly because nothing in the data can catch it.
 *   • Rows already restated by the plants turn processor are correct by
 *     construction. Guarded twice: skipped per-row when `plantsStartTurn` is
 *     set, and skipped world-wide when `gameState.marketSystemMode` is at the
 *     plants tier or above.
 *   • Anchor-currency worlds (fx == 1) are a no-op by arithmetic; they are
 *     counted and skipped rather than written.
 *
 * ─── IDEMPOTENCY / SAFETY ─────────────────────────────────────────────────
 * Marker `migrationsRun._id = "2026-08-01-fix-seed-sector-currency-denomination"`,
 * written by the runner AFTER a successful apply. NOT atomic: pause turn
 * processing before applying. On a crash mid-apply do NOT re-run — some rows
 * are scaled and the marker is unwritten, so a re-run double-scales. Restore
 * from backup and start over.
 *
 * Usage:
 *   npx tsx scripts/migrations/fixSeedSectorCurrencyDenomination.ts            # dry-run (default)
 *   npx tsx scripts/migrations/fixSeedSectorCurrencyDenomination.ts --apply
 *   npx tsx scripts/run-migrations.ts --only=2026-08-01-fix-seed-sector-currency-denomination
 */

import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import type { MigrationContext, MigrationResult } from "../../src/lib/migrations/types";
import { resolveSectorHostCurrencyCode } from "../../src/lib/currency/corporationCapital";
import { getMarketSystemModeForDb, marketAtLeast } from "../../src/lib/market/featureFlag";
import type { Corporation, CorporateSector, ExchangeRate } from "../../src/lib/db/types";

export const MIGRATION_ID = "2026-08-01-fix-seed-sector-currency-denomination";

/** Max clock gap between the corp doc and its founding sector doc. */
export const CREATED_AT_TOLERANCE_MS = 2_000;

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit-tested; no db access)
// ─────────────────────────────────────────────────────────────────────────────

/** The subset of a corp this migration reasons about. */
export interface ProvenanceCorp {
  ceoType?: string | null;
  type?: string | null;
  headquartersState?: string | null;
  createdAt?: Date | string | null;
}

/** The subset of a sector this migration reasons about. */
export interface ProvenanceSector {
  stateId?: string | null;
  sectorType?: string | null;
  createdAt?: Date | string | null;
  revenue?: number | null;
  plantsStartTurn?: number | null;
}

function toMillis(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Is this sector the one `spawnNppCorporation` inserted alongside `corp`?
 *
 * All four conditions are required. Dropping the timestamp check would sweep in
 * a founding-state sector the corp re-acquired later (after a shed, or via a
 * takeover of a same-state rival), which is correctly denominated.
 */
export function isSeedFoundingSector(
  sector: ProvenanceSector,
  corp: ProvenanceCorp,
  toleranceMs: number = CREATED_AT_TOLERANCE_MS
): boolean {
  if (corp.ceoType !== "npp") return false;
  if (!corp.headquartersState || sector.stateId !== corp.headquartersState) return false;
  if (!corp.type || sector.sectorType !== corp.type) return false;
  const sectorMs = toMillis(sector.createdAt);
  const corpMs = toMillis(corp.createdAt);
  if (sectorMs == null || corpMs == null) return false;
  return Math.abs(sectorMs - corpMs) <= toleranceMs;
}

export type SkipReason =
  | "not-seed-founding"
  | "already-plants-restated"
  | "no-host-currency"
  | "anchor-currency-noop"
  | "non-positive-revenue";

export type RedenominationPlan =
  | { action: "skip"; reason: SkipReason }
  | {
      action: "rescale";
      storedBefore: number;
      storedAfter: number;
      anchorBefore: number;
      anchorAfter: number;
    };

/**
 * Decide what (if anything) to do with one sector.
 *
 * `anchorBefore` is what every ₳-denominated reader sees TODAY (stored ÷ fx);
 * `anchorAfter` is what it will see once the field is denominated correctly,
 * which is simply the stored figure — that is the whole point: the number in
 * the field was always the ₳ value.
 */
export function planSectorRedenomination(args: {
  sector: ProvenanceSector;
  corp: ProvenanceCorp;
  hostCurrencyCode: string | null | undefined;
  hostFxRate: number;
  toleranceMs?: number;
}): RedenominationPlan {
  const { sector, corp, hostCurrencyCode, hostFxRate } = args;
  if (!isSeedFoundingSector(sector, corp, args.toleranceMs ?? CREATED_AT_TOLERANCE_MS)) {
    return { action: "skip", reason: "not-seed-founding" };
  }
  // Under plants `sectorTurn` restates revenue from capacity, in host currency,
  // on every tick after `plantsStartTurn` is stamped. Such a row is already right.
  if (typeof sector.plantsStartTurn === "number") {
    return { action: "skip", reason: "already-plants-restated" };
  }
  if (!hostCurrencyCode) return { action: "skip", reason: "no-host-currency" };
  if (!Number.isFinite(hostFxRate) || hostFxRate <= 0 || hostFxRate === 1) {
    return { action: "skip", reason: "anchor-currency-noop" };
  }
  const storedBefore = sector.revenue ?? 0;
  if (!Number.isFinite(storedBefore) || storedBefore <= 0) {
    return { action: "skip", reason: "non-positive-revenue" };
  }
  const storedAfter = Math.round(storedBefore * hostFxRate);
  return {
    action: "rescale",
    storedBefore,
    storedAfter,
    // What readers see now: the ₳ figure divided by fx a second time.
    anchorBefore: storedBefore / hostFxRate,
    // What readers will see: the ₳ figure, restored.
    anchorAfter: storedAfter / hostFxRate,
  };
}

/** One country's before/after ₳ totals, for the pre-apply report. */
export interface CountryImpact {
  countryId: string;
  sectorsRescaled: number;
  anchorBefore: number;
  anchorAfter: number;
}

/**
 * Roll per-sector ₳ figures up per country and attach world-share percentages.
 * `anchorBefore`/`anchorAfter` must already include UNTOUCHED sectors, so the
 * share columns describe the whole world, not just the moved rows.
 */
export function summarizeImpact(
  rows: CountryImpact[]
): Array<CountryImpact & { shareBefore: number; shareAfter: number; factor: number }> {
  const totalBefore = rows.reduce((s, r) => s + r.anchorBefore, 0);
  const totalAfter = rows.reduce((s, r) => s + r.anchorAfter, 0);
  return rows
    .map((r) => ({
      ...r,
      shareBefore: totalBefore > 0 ? (100 * r.anchorBefore) / totalBefore : 0,
      shareAfter: totalAfter > 0 ? (100 * r.anchorAfter) / totalAfter : 0,
      factor: r.anchorBefore > 0 ? r.anchorAfter / r.anchorBefore : 0,
    }))
    .sort((a, b) => b.shareAfter - a.shareAfter);
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration body
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export async function runFixSeedSectorCurrencyDenomination(
  db: Db,
  opts: Pick<MigrationContext, "dryRun"> = { dryRun: false }
): Promise<MigrationResult> {
  const notes: string[] = [];

  // World-level guard: under plants the field is derived and restated each turn.
  const plantsActive = marketAtLeast(await getMarketSystemModeForDb(db), "plants");
  if (plantsActive) {
    notes.push(
      "marketSystemMode is at the plants tier or above — `corporateSectors.revenue` is " +
        "derived from capacity and restated in host currency every turn, so there is " +
        "nothing to re-denominate. No-op."
    );
    return { documentsScanned: 0, documentsUpdated: 0, notes };
  }

  const rates = new Map<string, number>();
  for (const r of await db.collection<ExchangeRate>("exchangeRates").find({}).toArray()) {
    if (r.currencyCode && Number.isFinite(r.rate) && r.rate > 0) rates.set(r.currencyCode, r.rate);
  }

  const corps = await db.collection<Corporation>("corporations").find({}).toArray();
  const corpById = new Map(corps.map((c) => [c._id.toString(), c]));

  const sectors = await db.collection<CorporateSector>("corporateSectors").find({}).toArray();

  const impact = new Map<string, CountryImpact>();
  const skipCounts: Partial<Record<SkipReason | "orphan", number>> = {};
  const updates: Array<{ _id: CorporateSector["_id"]; revenue: number }> = [];

  for (const sector of sectors) {
    const corp = corpById.get(sector.corporationId?.toString() ?? "");
    if (!corp) {
      skipCounts.orphan = (skipCounts.orphan ?? 0) + 1;
      continue;
    }
    const hostCode = resolveSectorHostCurrencyCode(sector, corp);
    const hostFxRate = hostCode ? (rates.get(hostCode) ?? 1) : 1;
    const countryId = String(sector.countryId ?? corp.countryId ?? "??");
    const bucket =
      impact.get(countryId) ??
      (impact
        .set(countryId, { countryId, sectorsRescaled: 0, anchorBefore: 0, anchorAfter: 0 })
        .get(countryId) as CountryImpact);

    const plan = planSectorRedenomination({ sector, corp, hostCurrencyCode: hostCode, hostFxRate });

    if (plan.action === "skip") {
      skipCounts[plan.reason] = (skipCounts[plan.reason] ?? 0) + 1;
      // Untouched rows still contribute to both totals so the share columns
      // describe the whole world.
      const anchor = hostFxRate > 0 ? (sector.revenue ?? 0) / hostFxRate : (sector.revenue ?? 0);
      bucket.anchorBefore += anchor;
      bucket.anchorAfter += anchor;
      continue;
    }

    bucket.sectorsRescaled++;
    bucket.anchorBefore += plan.anchorBefore;
    bucket.anchorAfter += plan.anchorAfter;
    updates.push({ _id: sector._id, revenue: plan.storedAfter });
  }

  // ── REPORT BEFORE APPLYING ────────────────────────────────────────────────
  const summary = summarizeImpact([...impact.values()]);
  console.log(
    `\n[${MIGRATION_ID}] ${sectors.length} sectors scanned, ${updates.length} to re-denominate ` +
      `(${opts.dryRun ? "DRY-RUN" : "APPLY"}).`
  );
  console.log(`  skips: ${JSON.stringify(skipCounts)}`);
  console.log(
    "\n  country |  fixed |     ₳ before |      ₳ after | factor | share before | share after"
  );
  console.log(
    "  --------+--------+--------------+--------------+--------+--------------+------------"
  );
  for (const r of summary) {
    console.log(
      [
        `  ${r.countryId.padEnd(7)}`,
        String(r.sectorsRescaled).padStart(6),
        fmt(r.anchorBefore).padStart(12),
        fmt(r.anchorAfter).padStart(12),
        (r.factor ? r.factor.toFixed(2) + "x" : "-").padStart(6),
        (r.shareBefore.toFixed(2) + "%").padStart(12),
        (r.shareAfter.toFixed(2) + "%").padStart(11),
      ].join(" | ")
    );
  }
  console.log("");

  notes.push(
    `${updates.length} seed-founding sectors re-denominated ₳ → host currency across ` +
      `${summary.filter((r) => r.sectorsRescaled > 0).length} countries.`
  );
  for (const r of summary.filter((x) => x.sectorsRescaled > 0)) {
    notes.push(
      `${r.countryId}: ${r.sectorsRescaled} sectors, ₳ ${fmt(r.anchorBefore)} → ${fmt(r.anchorAfter)} ` +
        `(world share ${r.shareBefore.toFixed(2)}% → ${r.shareAfter.toFixed(2)}%)`
    );
  }

  if (opts.dryRun) {
    notes.push("DRY-RUN: no writes performed.");
    return { documentsScanned: sectors.length, documentsUpdated: 0, notes };
  }
  if (updates.length === 0) {
    return { documentsScanned: sectors.length, documentsUpdated: 0, notes };
  }

  const now = new Date();
  const res = await db.collection<CorporateSector>("corporateSectors").bulkWrite(
    updates.map((u) => ({
      updateOne: {
        filter: { _id: u._id },
        // PLANTS-GATED: this heal never runs at the plants tier — the world-level
        // guard above returns early, and any individually restated row (one with
        // `plantsStartTurn` stamped) is skipped by `planSectorRedenomination`.
        // Below plants `revenue` is authoritative and this is a pure change of
        // denomination, not of quantity.
        update: { $set: { revenue: u.revenue, updatedAt: now } },
      },
    }))
  );
  notes.push(`bulkWrite modified ${res.modifiedCount} rows.`);
  return {
    documentsScanned: sectors.length,
    documentsUpdated: res.modifiedCount,
    notes,
  };
}

async function main() {
  // Dry-run is the DEFAULT. `--dry-run` is accepted (and wins) so the flag from
  // the runner's vocabulary does the expected thing here too.
  const apply = process.argv.includes("--apply") && !process.argv.includes("--dry-run");
  const db = await connectDb();
  try {
    const result = await runFixSeedSectorCurrencyDenomination(db, { dryRun: !apply });
    for (const n of result.notes ?? []) console.log(`  ${n}`);
    if (!apply) {
      console.log(
        "\nDry-run complete. Re-run with --apply to write (marker NOT set by this path)."
      );
    }
  } finally {
    await closeDb();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
