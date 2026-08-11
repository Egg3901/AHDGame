// GET /api/forex/[currency]/holders — paginated largest holders of a currency
// across users (character wallets), corporations (liquidCapital), and national
// reserves (central banks). Public; forex-gated. Returns rows + per-type totals
// for the pie + grand total.
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import {
  COUNTRY_CURRENCY_MAP,
  FOREX_ACTIVE_CURRENCIES,
  type CurrencyCode,
} from "@/lib/constants/currencies";

type HolderType = "user" | "corp" | "reserve";

export async function GET(req: Request, { params }: { params: Promise<{ currency: string }> }) {
  try {
    if (!(await isForexEnabled())) {
      return NextResponse.json({ error: "Currency exchange is not yet enabled" }, { status: 403 });
    }
    const { currency } = await params;
    const ccy = currency.toUpperCase() as CurrencyCode;
    if (!FOREX_ACTIVE_CURRENCIES.includes(ccy)) {
      return NextResponse.json({ error: "Unknown currency" }, { status: 404 });
    }

    const url = new URL(req.url);
    const page = Math.max(0, parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
    const pageSize = Math.min(
      50,
      Math.max(5, parseInt(url.searchParams.get("pageSize") ?? "15", 10) || 15)
    );

    // Countries whose home currency IS this one — their CB reserveBalance counts
    // as holding it (foreign spread reserves count for every CB).
    const homeCountries = (Object.entries(COUNTRY_CURRENCY_MAP) as [string, CurrencyCode][])
      .filter(([, c]) => c === ccy)
      .map(([country]) => country);

    const db = await getDb();
    const balPath = `currencyBalances.personal.${ccy}`;

    const [facet] = await db
      .collection("characters")
      .aggregate([
        { $match: { [balPath]: { $gt: 0 } } },
        { $project: { _id: 0, name: 1, type: { $literal: "user" }, amount: `$${balPath}` } },
        {
          $unionWith: {
            coll: "corporations",
            pipeline: [
              { $match: { liquidCurrencyCode: ccy, liquidCapital: { $gt: 0 } } },
              {
                $project: { _id: 0, name: 1, type: { $literal: "corp" }, amount: "$liquidCapital" },
              },
            ],
          },
        },
        {
          $unionWith: {
            coll: "centralBanks",
            pipeline: [
              {
                $project: {
                  _id: 0,
                  name: { $concat: ["$countryId", " Central Bank"] },
                  type: { $literal: "reserve" },
                  amount: {
                    $add: [
                      { $ifNull: [`$spreadFeeReserveBalances.${ccy}`, 0] },
                      {
                        $cond: [
                          { $in: ["$countryId", homeCountries] },
                          { $ifNull: ["$reserveBalance", 0] },
                          0,
                        ],
                      },
                    ],
                  },
                },
              },
              { $match: { amount: { $gt: 0 } } },
            ],
          },
        },
        { $sort: { amount: -1, name: 1 } },
        {
          $facet: {
            rows: [{ $skip: page * pageSize }, { $limit: pageSize }],
            total: [{ $count: "n" }],
            byType: [{ $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } }],
            grand: [{ $group: { _id: null, total: { $sum: "$amount" } } }],
          },
        },
      ])
      .toArray();

    const total: number = facet?.total?.[0]?.n ?? 0;
    const grandTotal: number = facet?.grand?.[0]?.total ?? 0;
    const byType = Object.fromEntries(
      ((facet?.byType ?? []) as { _id: HolderType; total: number; count: number }[]).map((b) => [
        b._id,
        { total: b.total, count: b.count },
      ])
    ) as Partial<Record<HolderType, { total: number; count: number }>>;

    const rows = ((facet?.rows ?? []) as { name?: string; type: HolderType; amount: number }[]).map(
      (r, i) => ({
        rank: page * pageSize + i + 1,
        name: r.name ?? "Unknown",
        type: r.type,
        amount: r.amount,
      })
    );

    return NextResponse.json(
      { currency: ccy, page, pageSize, total, rows, byType, grandTotal },
      { headers: { "Cache-Control": "public, max-age=30, s-maxage=60, no-transform" } }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
