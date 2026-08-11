/**
 * Heal script: recompute every (state, sectorType) market to its canonical
 * 1991-preset GDP size, scaling both the unowned pool and the captured
 * corporateSectors by the same ratio so ownership % is preserved. Also deletes
 * orphaned unownedSectors (pre-Pinyin region codes). See
 * the design doc.
 *
 * Defaults to MONGODB_URI_LIVE (production heal). Nothing is written unless
 * --apply is passed.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-unowned-market-1991-recompute.ts              # dry-run, live DB
 *   npx tsx scripts/migrations/heal-unowned-market-1991-recompute.ts --apply      # write, live DB
 *   npx tsx scripts/migrations/heal-unowned-market-1991-recompute.ts --db=local   # target MONGODB_URI
 *   npx tsx scripts/migrations/heal-unowned-market-1991-recompute.ts --skip-owned # leave corporateSectors as-is
 *   npx tsx scripts/migrations/heal-unowned-market-1991-recompute.ts --country=CN # restrict to one country
 *   npx tsx scripts/migrations/heal-unowned-market-1991-recompute.ts --keep-orphans # do not delete orphan unowned docs
 */
import type { Db } from "mongodb";
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { computeUnownedSeedRevenue } from "@/lib/admin/seed/seedUnownedSectors";
import { CORPORATION_TYPES } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

const PRESET = "1991-default";

/** r = canonical / currentTotal. null when there is nothing to scale. */
export function computeMarketRescaleRatio(
  canonical: number,
  currentTotalAnchor: number
): number | null {
  if (!Number.isFinite(currentTotalAnchor) || currentTotalAnchor <= 0) return null;
  if (!Number.isFinite(canonical) || canonical < 0) return null;
  return canonical / currentTotalAnchor;
}

export interface MarketCell {
  stateId: string;
  sectorType: string;
  canonical: number;
  unowned: { _id: unknown; revenueAnchor: number } | null;
  owned: Array<{
    _id: unknown;
    revenueLocal: number;
    currentGrowthCost: number;
    fxLocalPerAnchor: number;
  }>;
}

export interface FieldOp {
  id: unknown;
  field: string;
  oldValue: number;
  newValue: number;
}

/**
 * Pure: for each cell, compute r = canonical / (unownedAnchor + ownedAnchor) and
 * scale every doc by it. Unowned revenue is ₳-native; owned revenue is the
 * owner's local currency (r is dimensionless, so the multiply is currency-safe).
 * Owned revenue is floored at 1 so a sector never rounds to a zero-revenue ghost.
 */
export function planMarketRescale(cells: MarketCell[]): {
  unownedOps: FieldOp[];
  ownedOps: FieldOp[];
} {
  const unownedOps: FieldOp[] = [];
  const ownedOps: FieldOp[] = [];

  for (const cell of cells) {
    const unownedAnchor = cell.unowned?.revenueAnchor ?? 0;
    let ownedAnchor = 0;
    for (const o of cell.owned) {
      const fx = o.fxLocalPerAnchor > 0 ? o.fxLocalPerAnchor : 1;
      ownedAnchor += (o.revenueLocal ?? 0) / fx;
    }
    const r = computeMarketRescaleRatio(cell.canonical, unownedAnchor + ownedAnchor);
    if (r === null) continue;

    if (cell.unowned && unownedAnchor !== 0) {
      unownedOps.push({
        id: cell.unowned._id,
        field: "revenue",
        oldValue: unownedAnchor,
        newValue: Math.round(unownedAnchor * r),
      });
    }
    for (const o of cell.owned) {
      if (typeof o.revenueLocal === "number" && o.revenueLocal !== 0) {
        ownedOps.push({
          id: o._id,
          field: "revenue",
          oldValue: o.revenueLocal,
          newValue: Math.max(1, Math.round(o.revenueLocal * r)),
        });
      }
      if (typeof o.currentGrowthCost === "number" && o.currentGrowthCost !== 0) {
        ownedOps.push({
          id: o._id,
          field: "currentGrowthCost",
          oldValue: o.currentGrowthCost,
          newValue: Math.round(o.currentGrowthCost * r),
        });
      }
    }
  }

  return { unownedOps, ownedOps };
}

export interface ApplyOptions {
  dryRun: boolean;
  includeOwned: boolean;
  deleteOrphans: boolean;
  countryIds?: string[];
}

export interface ApplySummary {
  cells: number;
  unownedOps: number;
  ownedOps: number;
  orphanUnownedToDelete: number;
  ownedInUnknownState: number;
  sampleUnowned: FieldOp[];
}

interface StateDoc {
  _id: string;
  countryId: string;
  gdp: number;
}

async function bulkApply(db: Db, collection: string, ops: FieldOp[], now: Date): Promise<void> {
  if (ops.length === 0) return;
  const writes = ops.map((op) => ({
    updateOne: {
      filter: { _id: op.id },
      update: { $set: { [op.field]: op.newValue, updatedAt: now } },
    },
  }));
  // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing — runtime shape is valid

  await db.collection(collection).bulkWrite(writes as any[]);
}

/**
 * Recompute every live (state, sectorType) market to its canonical 1991 size,
 * scaling the unowned pool and the captured corporateSectors by the same ratio
 * (ownership % preserved). Orphan unowned docs (no live state) are deleted.
 * Pure DB I/O — caller supplies the connection and the options.
 */
export async function applyMarketRescale(db: Db, opts: ApplyOptions): Promise<ApplySummary> {
  const now = new Date();

  // Load ALL live states (every country) for orphan detection — an orphan is a
  // market doc whose state exists in NO country, so this set must be unfiltered.
  // The country filter only narrows which cells get RESCALED, never which docs
  // count as orphans (else a --country=CN run would treat every other country's
  // markets as orphans and delete them).
  const allLiveStates = (await db
    .collection<StateDoc>("states")
    .find({ _id: { $not: /^NATIONAL_/ } })
    .toArray()) as StateDoc[];
  const allLiveStateIds = new Set(allLiveStates.map((s) => s._id));
  const states = opts.countryIds?.length
    ? allLiveStates.filter((s) => opts.countryIds!.includes(s.countryId))
    : allLiveStates;
  const liveStateIds = new Set(states.map((s) => s._id));

  const rates = (await db.collection("exchangeRates").find({}).toArray()) as unknown as Array<{
    currencyCode: string;
    rate: number;
  }>;
  const fxByCcy = new Map<string, number>();
  for (const r of rates) if (r.rate > 0) fxByCcy.set(r.currencyCode, r.rate);
  const fxForCcy = (ccy?: string) => (ccy && fxByCcy.get(ccy) ? fxByCcy.get(ccy)! : 1);

  const corps = (await db.collection("corporations").find({}).toArray()) as Array<{
    _id: unknown;
    countryId: string;
    liquidCurrencyCode?: string;
  }>;
  const corpCcy = new Map<string, string | undefined>(
    corps.map((c) => [
      String(c._id),
      c.liquidCurrencyCode ?? COUNTRY_CURRENCY_MAP[c.countryId as CountryId],
    ])
  );

  const allUnowned = (await db.collection("unownedSectors").find({}).toArray()) as Array<{
    _id: unknown;
    stateId: string;
    countryId: string;
    sectorType: string;
    revenue: number;
  }>;
  const allOwned = (await db.collection("corporateSectors").find({}).toArray()) as Array<{
    _id: unknown;
    stateId: string;
    sectorType: string;
    corporationId: unknown;
    revenue: number;
    currentGrowthCost?: number;
  }>;

  // Orphan = market for a state that exists in no country. In a country-scoped
  // run, only delete orphans belonging to the targeted countries so other
  // countries are left entirely untouched.
  let orphanUnowned = allUnowned.filter((u) => !allLiveStateIds.has(u.stateId));
  if (opts.countryIds?.length) {
    orphanUnowned = orphanUnowned.filter((u) => opts.countryIds!.includes(u.countryId));
  }
  const ownedInUnknownState = allOwned.filter((o) => !allLiveStateIds.has(o.stateId)).length;

  const key = (s: string, t: string) => `${s}|${t}`;
  const unownedByKey = new Map<string, (typeof allUnowned)[number]>();
  for (const u of allUnowned)
    if (liveStateIds.has(u.stateId)) unownedByKey.set(key(u.stateId, u.sectorType), u);
  const ownedByKey = new Map<string, (typeof allOwned)[number][]>();
  for (const o of allOwned) {
    if (!liveStateIds.has(o.stateId)) continue;
    const k = key(o.stateId, o.sectorType);
    const list = ownedByKey.get(k) ?? [];
    list.push(o);
    ownedByKey.set(k, list);
  }

  const cells: MarketCell[] = [];
  for (const s of states) {
    for (const sectorType of CORPORATION_TYPES) {
      const k = key(s._id, sectorType);
      const u = unownedByKey.get(k);
      const owned = opts.includeOwned ? (ownedByKey.get(k) ?? []) : [];
      if (!u && owned.length === 0) continue;
      const canonical = computeUnownedSeedRevenue({
        gdp: s.gdp,
        countryId: s.countryId as CountryId,
        stateId: s._id,
        sectorType,
        preset: PRESET,
      });
      cells.push({
        stateId: s._id,
        sectorType,
        canonical,
        unowned: u ? { _id: u._id, revenueAnchor: u.revenue ?? 0 } : null,
        owned: owned.map((o) => ({
          _id: o._id,
          revenueLocal: o.revenue ?? 0,
          currentGrowthCost: o.currentGrowthCost ?? 0,
          fxLocalPerAnchor: fxForCcy(corpCcy.get(String(o.corporationId))),
        })),
      });
    }
  }

  const { unownedOps, ownedOps } = planMarketRescale(cells);

  if (!opts.dryRun) {
    await bulkApply(db, "unownedSectors", unownedOps, now);
    if (opts.includeOwned) await bulkApply(db, "corporateSectors", ownedOps, now);
    if (opts.deleteOrphans && orphanUnowned.length > 0) {
      await db.collection("unownedSectors").deleteMany({
        _id: { $in: orphanUnowned.map((o) => o._id) },
        // _id values are runtime ObjectIds typed as unknown from the cursor
      } as any);
    }
  }

  return {
    cells: cells.length,
    unownedOps: unownedOps.length,
    ownedOps: opts.includeOwned ? ownedOps.length : 0,
    orphanUnownedToDelete: opts.deleteOrphans ? orphanUnowned.length : 0,
    ownedInUnknownState,
    sampleUnowned: unownedOps.slice(0, 8),
  };
}

function parseArgs(argv: string[]) {
  const has = (f: string) => argv.includes(f);
  const countryArg = argv.find((a) => a.startsWith("--country="));
  return {
    dryRun: !has("--apply"),
    includeOwned: !has("--skip-owned"),
    deleteOrphans: !has("--keep-orphans"),
    countryIds: countryArg ? [countryArg.split("=")[1].toUpperCase()] : undefined,
    dbTarget: has("--db=local") ? ("local" as const) : ("live" as const),
  };
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
  const opts = parseArgs(process.argv.slice(2));
  const uriKey = opts.dbTarget === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[uriKey];
  if (!uri) {
    console.error(`${uriKey} not set in .env.local`);
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db("a-house-divided");
    const gs = await db
      .collection<{ _id: string; isProcessing?: boolean; isActive?: boolean }>("gameState")
      .findOne({ _id: "current" });
    if (gs?.isProcessing === true || gs?.isActive === true) {
      console.warn("WARN: turns active/processing. Pause turns before --apply. Sleeping 10s…");
      await new Promise((r) => setTimeout(r, 10_000));
    }
    const res = await applyMarketRescale(db, {
      dryRun: opts.dryRun,
      includeOwned: opts.includeOwned,
      deleteOrphans: opts.deleteOrphans,
      countryIds: opts.countryIds,
    });
    console.log(
      `[heal-1991] ${opts.dryRun ? "DRY-RUN" : "APPLIED"} (${uriKey}) | cells=${res.cells} unownedOps=${res.unownedOps} ownedOps=${res.ownedOps} orphanDeletes=${res.orphanUnownedToDelete} ownedInUnknownState=${res.ownedInUnknownState}`
    );
    for (const op of res.sampleUnowned) {
      console.log(`  unowned ${String(op.id)} ${op.oldValue} -> ${op.newValue}`);
    }
    if (res.ownedInUnknownState > 0) {
      console.log(
        `  NOTE: ${res.ownedInUnknownState} owned sectors in non-live states (reported, not modified).`
      );
    }
    if (opts.dryRun) console.log("Re-run with --apply to write.");
  } finally {
    await client.close();
  }
}

const isMain =
  typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (isMain)
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
