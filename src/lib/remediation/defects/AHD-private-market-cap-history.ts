import { ObjectId, type Db } from "mongodb";
import type {
  Corporation,
  CorporationHistory,
  ExchangeRate,
  MarketCapHistory,
} from "@/lib/db/types";
import type { CorporationType } from "@/lib/constants/corporations";
import { getExchangeApiKey } from "@/lib/constants/exchangeRegistry";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { isStockMarketCorporation } from "@/lib/turn/corporation/marketCapSnapshot";
import type { Defect, DetectResult, HealPlan, HealResult, VerifyResult } from "../types";

type HistoryRow = MarketCapHistory & { _id: ObjectId };

interface UnlistedCaps {
  global: number;
  byExchange: Record<string, number>;
  bySector: Partial<Record<CorporationType, number>>;
}

interface RepairedRow {
  id: string;
  turn: number;
  before: number;
  after: number;
  set: Omit<MarketCapHistory, "turn" | "createdAt">;
}

interface Survey {
  rows: RepairedRow[];
  unlistedCorporations: number;
}

function subtract(value: number | undefined, amount: number): number {
  return Math.max(0, Math.round((value ?? 0) - amount));
}

function subtractCandle(
  close: number,
  high: number | undefined,
  low: number | undefined,
  amount: number
): { high: number; low: number } {
  const adjustedHigh = subtract(high ?? close, amount);
  const adjustedLow = subtract(low ?? close, amount);
  return {
    high: Math.max(close, adjustedHigh),
    low: Math.min(close, adjustedLow),
  };
}

export function removeUnlistedCaps(
  row: MarketCapHistory,
  unlisted: UnlistedCaps
): Omit<MarketCapHistory, "turn" | "createdAt"> {
  const globalMarketCap = subtract(row.globalMarketCap, unlisted.global);
  const globalCandle = subtractCandle(
    globalMarketCap,
    row.globalHigh,
    row.globalLow,
    unlisted.global
  );
  const exchangeCaps = Object.fromEntries(
    Object.entries(row.exchangeCaps ?? {}).map(([key, candle]) => {
      const amount = unlisted.byExchange[key] ?? 0;
      const marketCap = subtract(candle.marketCap, amount);
      const adjusted = subtractCandle(marketCap, candle.high, candle.low, amount);
      return [key, { marketCap, high: adjusted.high, low: adjusted.low }];
    })
  );
  const nyseAmount = unlisted.byExchange.nyse ?? 0;
  const ftseAmount = unlisted.byExchange.ftse ?? 0;
  const nyseMarketCap = subtract(row.nyseMarketCap, nyseAmount);
  const ftseMarketCap = subtract(row.ftseMarketCap, ftseAmount);
  const nyseCandle = subtractCandle(nyseMarketCap, row.nyseHigh, row.nyseLow, nyseAmount);
  const ftseCandle = subtractCandle(ftseMarketCap, row.ftseHigh, row.ftseLow, ftseAmount);
  const bySector = Object.fromEntries(
    Object.entries(row.bySector).map(([sector, value]) => [
      sector,
      subtract(value, unlisted.bySector[sector as CorporationType] ?? 0),
    ])
  ) as Partial<Record<CorporationType, number>>;

  return {
    listingUniverse: "public-only",
    globalMarketCap,
    globalHigh: globalCandle.high,
    globalLow: globalCandle.low,
    nyseMarketCap,
    nyseHigh: nyseCandle.high,
    nyseLow: nyseCandle.low,
    ftseMarketCap,
    ftseHigh: ftseCandle.high,
    ftseLow: ftseCandle.low,
    exchangeCaps,
    bySector,
  };
}

async function survey(db: Db): Promise<Survey> {
  const [rows, corporations, rates] = await Promise.all([
    db
      .collection<HistoryRow>("marketCapHistory")
      .find({ listingUniverse: { $ne: "public-only" } })
      .sort({ turn: 1 })
      .toArray(),
    db.collection<Corporation>("corporations").find({}).toArray(),
    db.collection<ExchangeRate>("exchangeRates").find({}).toArray(),
  ]);
  const unlisted = corporations.filter((corp) => !isStockMarketCorporation(corp));
  if (rows.length === 0 || unlisted.length === 0) {
    return {
      rows: rows.map((row) => ({
        id: row._id.toString(),
        turn: row.turn,
        before: row.globalMarketCap,
        after: row.globalMarketCap,
        set: removeUnlistedCaps(row, { global: 0, byExchange: {}, bySector: {} }),
      })),
      unlistedCorporations: unlisted.length,
    };
  }

  const corpById = new Map(unlisted.map((corp) => [corp._id.toString(), corp]));
  const currentRate = new Map(rates.map((rate) => [rate.currencyCode, rate.rate]));
  const histories = await db
    .collection<CorporationHistory>("corporationHistory")
    .find({
      corporationId: { $in: unlisted.map((corp) => corp._id) },
      turn: { $in: rows.map((row) => row.turn) },
    })
    .toArray();
  const capsByTurn = new Map<number, UnlistedCaps>();
  for (const history of histories) {
    const corp = corpById.get(history.corporationId.toString());
    if (!corp) continue;
    const rate = history.fxRateAtWrite ?? currentRate.get(history.currencyCode ?? "USD") ?? 1;
    const cap = readCorpEconomicAnchor(history.marketCap, history.currencyCode, rate);
    const totals = capsByTurn.get(history.turn) ?? { global: 0, byExchange: {}, bySector: {} };
    totals.global += cap;
    const exchange = getExchangeApiKey(corp.countryId);
    if (exchange) totals.byExchange[exchange] = (totals.byExchange[exchange] ?? 0) + cap;
    totals.bySector[corp.type] = (totals.bySector[corp.type] ?? 0) + cap;
    capsByTurn.set(history.turn, totals);
  }

  return {
    rows: rows.map((row) => {
      const set = removeUnlistedCaps(
        row,
        capsByTurn.get(row.turn) ?? { global: 0, byExchange: {}, bySector: {} }
      );
      return {
        id: row._id.toString(),
        turn: row.turn,
        before: row.globalMarketCap,
        after: set.globalMarketCap,
        set,
      };
    }),
    unlistedCorporations: unlisted.length,
  };
}

async function detect(db: Db): Promise<DetectResult> {
  const result = await survey(db);
  return {
    affected: result.rows.length,
    sample: result.rows.slice(-10).map(({ turn, before, after }) => ({ turn, before, after })),
    notes: [
      `${result.rows.length} legacy market snapshot(s) use the all-corporation universe`,
      `${result.unlistedCorporations} currently private or hidden corporation(s) are excluded by the repair`,
    ],
  };
}

async function plan(db: Db): Promise<HealPlan> {
  const result = await survey(db);
  return {
    affected: result.rows.length,
    touched: [{ collection: "marketCapHistory", ids: result.rows.map((row) => row.id) }],
    moneyDelta: 0,
    summary: `restate ${result.rows.length} legacy market snapshot(s) to the public listing universe`,
    notes: [
      "The repair subtracts private and hidden corporations using their per-turn corporation history.",
      "Candle spreads are preserved after removing the unlisted market capitalization.",
    ],
    payload: result,
  };
}

async function apply(db: Db, healPlan: HealPlan): Promise<HealResult> {
  const result = healPlan.payload as Survey;
  if (result.rows.length === 0) return { documentsScanned: 0, documentsUpdated: 0 };
  const write = await db.collection<HistoryRow>("marketCapHistory").bulkWrite(
    result.rows.map((row) => ({
      updateOne: {
        filter: { _id: new ObjectId(row.id), listingUniverse: { $ne: "public-only" } },
        update: { $set: row.set },
      },
    })),
    { ordered: true }
  );
  if (write.modifiedCount !== result.rows.length) {
    throw new Error(
      `updated ${write.modifiedCount} of ${result.rows.length} approved market snapshots`
    );
  }
  return {
    documentsScanned: result.rows.length,
    documentsUpdated: write.modifiedCount,
    notes: [`restated ${write.modifiedCount} market snapshot(s) to public-only`],
  };
}

async function verify(db: Db): Promise<VerifyResult> {
  const remaining = await db
    .collection<MarketCapHistory>("marketCapHistory")
    .countDocuments({ listingUniverse: { $ne: "public-only" } });
  return {
    ok: remaining === 0,
    remaining,
    notes: [
      remaining === 0
        ? "every market snapshot is marked as public-only"
        : `${remaining} legacy all-corporation snapshot(s) remain`,
    ],
  };
}

export const defect: Defect = {
  id: "AHD-private-market-cap-history",
  title: "Private corporations contaminated stock-market capitalization history",
  severity: "P1",
  codeFix: { mergedTo: "main" },
  seedFix: {
    status: "not-needed",
    note: "market snapshots are created only by runtime turn processing and are not present in seeds",
  },
  envs: ["dev", "sandbox", "prod"],
  idempotent: true,
  guards: ["turn-lock-free", "max-affected:500", "money-conserving"],
  detect,
  plan,
  apply,
  verify,
};
