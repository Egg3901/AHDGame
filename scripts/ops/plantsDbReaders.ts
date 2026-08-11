/**
 * Shared read helpers for the plants transition ops scripts.
 *
 * `plantsPreflight.ts` and `plantsWatch.ts` both need the same three awkward
 * things, and neither should be reimplementing them:
 *
 *  1. **The FX boundary.** Sector economic fields are stored in the sector's
 *     HOST-state currency, not the corp's, and every figure the pure reporting
 *     layer takes is in ₳. Converting per sector via
 *     `resolveSectorHostCurrencyCode` + `fxRateForSectorHostFromMap` +
 *     `readCorpEconomicAnchor` is exactly what the turn processor does; doing
 *     it any other way reproduces the t841 class of bug, where a raw local
 *     figure was treated as an anchor figure and inflated a whole commodity by
 *     three orders of magnitude.
 *  2. **Streaming.** A live world has hundreds of thousands of sectors. Both
 *     scripts are read-only reports, but neither may pull the collection into
 *     memory as documents — they stream and keep only the projected fields.
 *  3. **A consistent projection**, so the two reports cannot silently disagree
 *     about which fields they looked at.
 *
 * Read-only. Nothing in this file writes.
 */
import type { Db } from "mongodb";
import type { CurrencyCode } from "../../src/lib/db/types";
import type { CorporateSector, Corporation } from "../../src/lib/db/types/corporation";
import {
  fxRateForSectorHostFromMap,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
} from "../../src/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "../../src/lib/currency/corpEconomyFields";

/** The corp fields needed to resolve a sector's currency and cash. */
export interface CorpCurrencyRow {
  countryId?: string;
  liquidCurrencyCode?: CurrencyCode;
  liquidCapital?: number;
}

/** A sector document with its money already normalized to ₳. */
export interface AnchoredSectorRow {
  id: string;
  corporationId: string | null;
  sectorType: CorporateSector["sectorType"];
  stateId: string | null;
  countryId: string | null;
  strategyId: string | null;
  transitionFromStrategyId: string | null;
  transitionStartTurn: number | null;
  plantsStartTurn: number | null;
  capitalStock: number | null;
  producedUnits: number | null;
  soldUnits: number | null;
  mothballed: boolean;
  buildQueue: CorporateSector["buildQueue"];
  /** ₳ */
  revenueAnchor: number;
  /** ₳ */
  currentGrowthCostAnchor: number;
  /** ₳ — already anchor-denominated on the document, NOT converted. */
  constructionInProgressAnchor: number;
  /** ₳, or null when the sector carries no restore point. */
  legacyRevenueShadowAnchor: number | null;
}

/** Fields both reports read. Keep in one place so they cannot drift. */
export const SECTOR_PROJECTION = {
  _id: 1,
  corporationId: 1,
  sectorType: 1,
  stateId: 1,
  countryId: 1,
  strategyId: 1,
  transitionFromStrategyId: 1,
  transitionStartTurn: 1,
  plantsStartTurn: 1,
  capitalStock: 1,
  producedUnits: 1,
  soldUnits: 1,
  mothballed: 1,
  buildQueue: 1,
  revenue: 1,
  currentGrowthCost: 1,
  constructionInProgressAnchor: 1,
  legacyRevenueShadow: 1,
} as const;

function n(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Load every corp's currency info once, keyed by string id.
 *
 * Corps are orders of magnitude fewer than sectors, so this is a small map,
 * and it saves a per-sector lookup that would otherwise be a query each.
 */
export async function loadCorpCurrencyMap(db: Db): Promise<Map<string, CorpCurrencyRow>> {
  const out = new Map<string, CorpCurrencyRow>();
  const cursor = db
    .collection<Corporation>("corporations")
    .find({}, { projection: { _id: 1, countryId: 1, liquidCurrencyCode: 1, liquidCapital: 1 } });
  for await (const c of cursor) {
    out.set(c._id.toString(), {
      countryId: c.countryId,
      liquidCurrencyCode: c.liquidCurrencyCode,
      liquidCapital: c.liquidCapital,
    });
  }
  return out;
}

/**
 * Stream `corporateSectors`, handing each row to `onRow` with money in ₳.
 *
 * Returns the number of rows seen. Sectors whose corp is missing still yield —
 * an orphaned sector is exactly the kind of thing a preflight should see — and
 * fall back to their own `countryId` for currency resolution.
 */
export async function streamAnchoredSectors(
  db: Db,
  onRow: (row: AnchoredSectorRow) => void,
  opts: { filter?: Record<string, unknown> } = {}
): Promise<number> {
  const fxByCurrency = await loadFxRatesByCurrency(db);
  const corps = await loadCorpCurrencyMap(db);

  let count = 0;
  const cursor = db
    .collection<CorporateSector>("corporateSectors")
    .find(opts.filter ?? {}, { projection: SECTOR_PROJECTION });

  for await (const s of cursor) {
    const corpId = s.corporationId ? s.corporationId.toString() : null;
    const corp = corpId ? (corps.get(corpId) ?? null) : null;
    const code = resolveSectorHostCurrencyCode(s, corp);
    const rate = fxRateForSectorHostFromMap(s, corp, fxByCurrency);

    const shadow = n(s.legacyRevenueShadow);
    onRow({
      id: s._id.toString(),
      corporationId: corpId,
      sectorType: s.sectorType,
      stateId: s.stateId ?? null,
      countryId: s.countryId ?? null,
      strategyId: s.strategyId ?? null,
      transitionFromStrategyId: s.transitionFromStrategyId ?? null,
      transitionStartTurn: n(s.transitionStartTurn),
      plantsStartTurn: n(s.plantsStartTurn),
      capitalStock: n(s.capitalStock),
      producedUnits: n(s.producedUnits),
      soldUnits: n(s.soldUnits),
      mothballed: s.mothballed === true,
      buildQueue: Array.isArray(s.buildQueue) ? s.buildQueue : [],
      revenueAnchor: readCorpEconomicAnchor(n(s.revenue) ?? 0, code, rate),
      currentGrowthCostAnchor: readCorpEconomicAnchor(n(s.currentGrowthCost) ?? 0, code, rate),
      // Already an anchor field by name and by construction — converting it
      // would deflate it by the FX rate a second time.
      constructionInProgressAnchor: n(s.constructionInProgressAnchor) ?? 0,
      legacyRevenueShadowAnchor: shadow == null ? null : readCorpEconomicAnchor(shadow, code, rate),
    });
    count++;
  }
  return count;
}

/** Corp liquid capital in ₳, for the cash distribution. */
export async function loadCorpCashAnchors(db: Db): Promise<number[]> {
  const fxByCurrency = await loadFxRatesByCurrency(db);
  const out: number[] = [];
  const cursor = db
    .collection<Corporation>("corporations")
    .find({}, { projection: { liquidCapital: 1, liquidCurrencyCode: 1, countryId: 1 } });
  for await (const c of cursor) {
    const rate = fxRateForSectorHostFromMap(null, c, fxByCurrency);
    out.push(readCorpEconomicAnchor(n(c.liquidCapital) ?? 0, c.liquidCurrencyCode, rate));
  }
  return out;
}

/** Current world turn, or 0 when the world has no gameState doc. */
export async function readCurrentTurn(db: Db): Promise<number> {
  const gs = await db
    .collection<{ _id: string; currentTurn?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentTurn: 1 } });
  return n(gs?.currentTurn) ?? 0;
}

/** In-game year for era-priced capacity, or null when unknown. */
export async function readCurrentYear(db: Db): Promise<number | null> {
  const cfg = await db
    .collection<{ _id: string; seedYear?: number }>("gameConfig")
    .findOne({ _id: "default" }, { projection: { seedYear: 1 } });
  const gs = await db
    .collection<{ _id: string; currentYear?: number; year?: number }>("gameState")
    .findOne({ _id: "current" }, { projection: { currentYear: 1, year: 1 } });
  return n(gs?.currentYear) ?? n(gs?.year) ?? n(cfg?.seedYear);
}

/** Whether a migration marker exists in `migrationsRun`. */
export async function migrationHasRun(db: Db, markerId: string): Promise<boolean> {
  const marker = await db
    .collection<{ _id: string }>("migrationsRun")
    .findOne({ _id: markerId }, { projection: { _id: 1 } });
  return marker != null;
}

/**
 * Count active crisis EFFECTS by physicality.
 *
 * `physicality` absent means financial — that is the engine's default, and it
 * is the state every crisis spawned before the plants work carries. It matters
 * at the flip because a financial-only effect never reduces physical output,
 * so a pre-flip disaster stops constraining production the moment capacity
 * becomes authoritative.
 */
export async function countCrisisEffectPhysicality(
  db: Db
): Promise<{ financialOnly: number; legacyUnflagged: number; physical: number }> {
  const out = { financialOnly: 0, legacyUnflagged: 0, physical: 0 };
  const cursor = db
    .collection<{ status?: string; resolved?: boolean; effects?: { physicality?: string }[] }>(
      "crises"
    )
    .find(
      { $and: [{ resolved: { $ne: true } }, { status: { $nin: ["resolved", "expired"] } }] },
      { projection: { effects: 1 } }
    );
  for await (const c of cursor) {
    for (const e of c.effects ?? []) {
      if (e?.physicality === "physical") out.physical++;
      else if (e?.physicality === "financial") out.financialOnly++;
      else out.legacyUnflagged++;
    }
  }
  return out;
}

/** Unowned-pool readiness for the plants leading field. */
export async function readUnownedHeadroomStatus(
  db: Db
): Promise<{ total: number; missingHeadroomUnits: number }> {
  const col = db.collection("unownedSectors");
  const total = await col.countDocuments({});
  const missingHeadroomUnits = await col.countDocuments({
    $or: [{ headroomUnits: { $exists: false } }, { headroomUnits: null }],
  });
  return { total, missingHeadroomUnits };
}

/** Live commodity prices, keyed by commodity. */
export async function readCommodityPrices(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const cursor = db
    .collection<{ commodity?: string; _id: unknown; price?: number }>("commodityPrices")
    .find({}, { projection: { commodity: 1, price: 1 } });
  for await (const d of cursor) {
    const key = d.commodity ?? String(d._id);
    const p = n(d.price);
    if (key && p != null) out[key] = p;
  }
  return out;
}

/** `--flag=value` / `--flag value`, or undefined. */
export function argValue(name: string, argv: readonly string[] = process.argv): string | undefined {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] != null && !argv[idx + 1]!.startsWith("--")) return argv[idx + 1];
  return undefined;
}

export function argNumber(
  name: string,
  argv: readonly string[] = process.argv
): number | undefined {
  const raw = argValue(name, argv);
  if (raw == null) return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export function argFlag(name: string, argv: readonly string[] = process.argv): boolean {
  return argv.includes(`--${name}`);
}
