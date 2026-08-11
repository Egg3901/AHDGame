// GET /api/admin/forex
// Returns all exchange rates with history. INT is always included at rate 1.0.
// Auth: requireAdmin
// Errors: 401, 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { ExchangeRate } from "@/lib/db/types";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const rates = await db.collection<ExchangeRate>("exchangeRates").find({}).toArray();

    const rows = rates.map((r) => ({
      countryId: r.countryId,
      currencyCode: r.currencyCode,
      rate: r.rate,
      baseRate: r.baseRate,
      deviation: ((r.rate - r.baseRate) / r.baseRate) * 100,
      hardPeg: r.hardPeg ?? null,
      history: r.rateHistory ?? [],
    }));

    // Prepend synthetic INT row (internal unit, always 1.0)
    const intRow = {
      countryId: "INT",
      currencyCode: "INT",
      rate: 1.0,
      baseRate: 1.0,
      deviation: 0,
      hardPeg: null,
      history: [],
    };

    return NextResponse.json({ currencies: [intRow, ...rows] });
  } catch (error) {
    return handleRouteError(error);
  }
}
