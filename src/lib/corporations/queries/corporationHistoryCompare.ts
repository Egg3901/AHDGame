import type { Db } from "mongodb";
import type { Corporation, CorporationHistory } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

/**
 * Read query + pure helpers backing the corporation "Snapshot" tab — a
 * turn-over-turn compare table (suggestion #97). Distinct from the Charts tab:
 * Charts LINE-PLOTS a single metric across every turn; this loads the same
 * persisted `corporationHistory` rows but reduces them to five headline metrics
 * and computes the absolute + %Δ between TWO chosen turns (turn A vs turn B).
 *
 * READ-ONLY: no turn-engine or write dependency. The loader only reads
 * `corporationHistory`; the delta math is pure and client-importable (this
 * module has no server-only runtime imports — `Db` is a type-only import and
 * the collection is reached through the injected `db`).
 */

/** Most-recent per-turn snapshots the compare selector loads. */
export const SNAPSHOT_COMPARE_MAX_POINTS = 500;

/**
 * One persisted per-turn snapshot reduced to the five compare metrics. Money
 * fields stay in the row's own `currencyCode` (like the raw history rows the
 * Charts tab consumes); the client normalizes each to ₳ via `fxRateAtWrite`
 * before diffing so snapshots taken at different FX rates stay comparable.
 */
export interface CorpHistoryComparePoint {
  turn: number;
  sharePrice: number;
  marketCap: number;
  liquidCapital: number;
  revenue: number;
  income: number;
  currencyCode?: CurrencyCode;
  fxRateAtWrite?: number;
}

export interface CorporationHistoryCompareData {
  /** Deduped per-turn points, ascending by turn (most-recent N). */
  points: CorpHistoryComparePoint[];
  /** Representative currency (latest snapshot's) for formatting the table. */
  currencyCode?: CurrencyCode;
}

export type SnapshotMetricKey = "revenue" | "income" | "marketCap" | "sharePrice" | "liquidCapital";

export interface SnapshotMetricDef {
  key: SnapshotMetricKey;
  label: string;
  /** "money" → compact currency formatting; "price" → share-price precision. */
  format: "money" | "price";
  description: string;
}

/**
 * The five headline metrics, in table row order. A rise is "good" for all five
 * (higher revenue / income / market cap / share price / cash reserves), so the
 * delta coloring never inverts — unlike the National Budget compare, where
 * rising spending / debt is bad.
 */
export const SNAPSHOT_COMPARE_METRICS: readonly SnapshotMetricDef[] = [
  {
    key: "revenue",
    label: "Revenue / turn",
    format: "money",
    description: "Operating revenue booked per turn.",
  },
  {
    key: "income",
    label: "Net income / turn",
    format: "money",
    description: "Retained income per turn after costs, tax, and dividends.",
  },
  {
    key: "marketCap",
    label: "Market cap",
    format: "money",
    description: "Share price times shares outstanding.",
  },
  {
    key: "sharePrice",
    label: "Share price",
    format: "price",
    description: "Quoted stock price.",
  },
  {
    key: "liquidCapital",
    label: "Liquid capital",
    format: "money",
    description: "Cash reserves on hand.",
  },
];

export interface SnapshotDelta extends SnapshotMetricDef {
  /** Turn-A value (₳). */
  then: number;
  /** Turn-B value (₳). */
  now: number;
  /** now − then (₳). */
  delta: number;
  /** Percent change vs `then`; null when `then` is 0 (no baseline). */
  pctDelta: number | null;
}

/**
 * Reduce a compare point to its five metrics normalized to ₳ (anchor), using
 * the supplied `toAnchor` (the currency context's rate-aware converter, same as
 * the Charts tab). Pure — no currency state of its own.
 */
export function toAnchorMetricMap(
  point: CorpHistoryComparePoint,
  toAnchor: (val: number, code?: string, fxRateAtWrite?: number) => number
): Record<SnapshotMetricKey, number> {
  const conv = (v: number) => toAnchor(v, point.currencyCode, point.fxRateAtWrite);
  return {
    revenue: conv(point.revenue),
    income: conv(point.income),
    marketCap: conv(point.marketCap),
    sharePrice: conv(point.sharePrice),
    liquidCapital: conv(point.liquidCapital),
  };
}

/**
 * Compute per-metric deltas between two ₳-normalized metric maps (turn A → turn
 * B). Pure and framework-free so it is unit-testable and safe to import into the
 * client tab. Callers pass maps already in ₳ (see {@link toAnchorMetricMap}) so
 * the table stays currency-consistent across snapshots at different FX rates.
 */
export function computeSnapshotDeltas(
  fromAnchor: Record<SnapshotMetricKey, number>,
  toAnchor: Record<SnapshotMetricKey, number>
): SnapshotDelta[] {
  return SNAPSHOT_COMPARE_METRICS.map((m) => {
    const then = fromAnchor[m.key];
    const now = toAnchor[m.key];
    const delta = now - then;
    const pctDelta = then !== 0 ? (delta / Math.abs(then)) * 100 : null;
    return { ...m, then, now, delta, pctDelta };
  });
}

/**
 * Load a corporation's per-turn history reduced to the compare metrics — one row
 * per turn (last-written wins), the most-recent `limit` turns, ascending. This
 * is the "loads the corp's history rows" half of the feature; the diff between
 * two of these rows is done by {@link computeSnapshotDeltas}.
 */
export async function loadCorporationHistoryComparePoints(args: {
  db: Db;
  corporation: Pick<Corporation, "_id" | "liquidCurrencyCode">;
  limit?: number;
}): Promise<CorporationHistoryCompareData> {
  const { db, corporation, limit = SNAPSHOT_COMPARE_MAX_POINTS } = args;

  const points = await db
    .collection<CorporationHistory>("corporationHistory")
    .aggregate<CorpHistoryComparePoint>([
      { $match: { corporationId: corporation._id } },
      // One row per turn — keep the last-written snapshot for that turn (mirrors
      // the /history route's dedupe so a re-run turn doesn't double a point).
      { $sort: { turn: -1, createdAt: -1, _id: -1 } },
      { $group: { _id: "$turn", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      // Most-recent N turns, then present ascending for the turn selector.
      { $sort: { turn: -1 } },
      { $limit: Math.max(2, limit) },
      { $sort: { turn: 1 } },
      {
        $project: {
          _id: 0,
          turn: 1,
          sharePrice: 1,
          marketCap: 1,
          liquidCapital: 1,
          revenue: 1,
          income: 1,
          currencyCode: 1,
          fxRateAtWrite: 1,
        },
      },
    ])
    .toArray();

  const representative = points.length > 0 ? points[points.length - 1].currencyCode : undefined;
  return {
    points,
    currencyCode: representative ?? corporation.liquidCurrencyCode,
  };
}
