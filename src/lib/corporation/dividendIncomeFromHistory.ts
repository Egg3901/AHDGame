import type { Db, ObjectId } from "mongodb";
import type { CorporationHistory } from "@/lib/db/types";

export type CorpHistoryDividendRow = Pick<
  CorporationHistory,
  "income" | "dividendRate" | "totalShares" | "dividendPaidPerTurn"
>;

export function estimateCorpDividendPaidLastTurn(h: CorpHistoryDividendRow): number {
  if (
    typeof h.dividendPaidPerTurn === "number" &&
    Number.isFinite(h.dividendPaidPerTurn) &&
    h.dividendPaidPerTurn >= 0
  ) {
    return h.dividendPaidPerTurn;
  }
  const r = h.dividendRate ?? 0;
  const income = h.income ?? 0;
  if (r <= 0 || r >= 94.5 || income < 0) return 0;
  const denom = 100 - r;
  if (denom < 5.5) return 0;
  return (income * r) / denom;
}

export async function fetchLatestCorpHistoryDividendRows(
  db: Db,
  corporationIds: ObjectId[]
): Promise<Map<string, CorpHistoryDividendRow>> {
  if (corporationIds.length === 0) return new Map();

  const rows = await db
    .collection<CorporationHistory>("corporationHistory")
    .aggregate<{
      _id: ObjectId;
      lastIncome: number;
      lastDividendRate: number;
      lastTotalShares: number;
      lastDividendPaidPerTurn?: number;
    }>([
      { $match: { corporationId: { $in: corporationIds } } },
      { $sort: { turn: -1 } },
      {
        $group: {
          _id: "$corporationId",
          lastIncome: { $first: "$income" },
          lastDividendRate: { $first: "$dividendRate" },
          lastTotalShares: { $first: "$totalShares" },
          lastDividendPaidPerTurn: { $first: "$dividendPaidPerTurn" },
        },
      },
    ])
    .toArray();

  return new Map(
    rows.map((r) => [
      r._id.toString(),
      {
        income: r.lastIncome ?? 0,
        dividendRate: r.lastDividendRate ?? 0,
        totalShares: r.lastTotalShares ?? 0,
        dividendPaidPerTurn: r.lastDividendPaidPerTurn,
      },
    ])
  );
}
