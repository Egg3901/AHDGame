import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import type { ExchangeRate } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";

// GET /api/forex/rates — Returns current exchange rates as a simple map (local currency per 1 internal unit)
// Auth: public
// Errors: 403 (forex disabled), 500
export async function GET() {
  try {
    const [db, forexActive] = await Promise.all([getDb(), isForexEnabled()]);
    if (!forexActive) {
      return NextResponse.json({ error: "Forex not enabled" }, { status: 403 });
    }

    const rateRows = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();

    const rates: Partial<Record<CurrencyCode, number>> = {};
    const baseRates: Partial<Record<CurrencyCode, number>> = {};
    /** Public intervention band info per currency — no reserve numbers. */
    const interventionBands: Partial<
      Record<
        CurrencyCode,
        { floor: number; ceiling: number; setAtTurn: number; defending: boolean }
      >
    > = {};
    for (const row of rateRows) {
      rates[row.currencyCode] = row.rate;
      baseRates[row.currencyCode] = row.baseRate;
      if (row.interventionPolicy) {
        const p = row.interventionPolicy;
        interventionBands[row.currencyCode] = {
          floor: p.floor,
          ceiling: p.ceiling,
          setAtTurn: p.setAtTurn,
          defending: row.rate < p.floor || row.rate > p.ceiling,
        };
      }
    }

    return NextResponse.json(
      { rates, baseRates, interventionBands },
      {
        headers: {
          "Cache-Control":
            "public, max-age=15, s-maxage=30, stale-while-revalidate=60, no-transform",
        },
      }
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
