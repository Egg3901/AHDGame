// POST /api/admin/forex/seed-reserves — One-shot seeding of CB reserves for launch
// Auth: requireAdmin
// Errors: 400, 403
// Idempotent: countries with a non-zero reserveBalance are skipped.

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { createAdminLog } from "@/lib/adminLog";
import { FOREX_ACTIVE_COUNTRIES, COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CentralBank } from "@/lib/db/types";
import type { TradeHistoryEntry } from "@/lib/db/types/tradeHistory";
import type { CountryId } from "@/lib/constants/countries";
import { getBankId } from "@/lib/centralBank/helpers";

/** Flat fallback reserves when the country has insufficient trade/LOC history to derive an estimate.
 *  Values are in home-currency face units — same unit as reserveBalance. */
const FALLBACK_RESERVE_SEED: Partial<Record<CountryId, number>> = {
  US: 5_000_000_000,
  UK: 3_000_000_000,
  JP: 500_000_000_000,
  DE: 3_000_000_000,
  // NG has no forex trade history yet (currency just enabled), so it always
  // falls back. ~2T naira ≈ 1.3B USD at the 1550 starting rate — a mid-size
  // emerging-market war chest for the CBN to defend the band. Tune as needed.
  NG: 2_000_000_000_000,
};

export async function POST() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const now = new Date();
    const seeded: Record<string, number> = {};
    const skipped: string[] = [];

    for (const countryId of FOREX_ACTIVE_COUNTRIES) {
      // getBankId: DE's bank doc is the shared "ECB" — a raw countryId lookup
      // returned null and silently skipped seeding the EUR reserve entirely.
      const bankId = getBankId(countryId);
      const bank = await db.collection<CentralBank>("centralBanks").findOne({ _id: bankId });
      if (!bank) continue;
      if ((bank.reserveBalance ?? 0) > 0) {
        skipped.push(countryId);
        continue;
      }

      // Seed = 6 × avg_turn_spread + 12 × projected_LOC_interest (recent 48 turns).
      // Fallback to FALLBACK_RESERVE_SEED when trade history is sparse.
      const currencyCode = COUNTRY_CURRENCY_MAP[countryId];
      const recentTrades = await db
        .collection<TradeHistoryEntry>("tradeHistory")
        .find({
          $or: [{ fromCurrency: currencyCode }, { toCurrency: currencyCode }],
        })
        .sort({ turn: -1 })
        .limit(500)
        .toArray();

      let seedAmount = FALLBACK_RESERVE_SEED[countryId] ?? 0;
      if (recentTrades.length >= 48) {
        const totalSpread = recentTrades.reduce((sum, t) => sum + (t.spread ?? 0), 0);
        const avgTurnSpread = (totalSpread / recentTrades.length) * 48;
        const projectedLocInterest = (bank.reserveBalance ?? 0) * 0.5;
        const derived = 6 * avgTurnSpread + 12 * projectedLocInterest;
        // If the derived value is far below the fallback baseline, keep the
        // fallback so chairs have a real war chest to start with.
        const fallback = FALLBACK_RESERVE_SEED[countryId] ?? 0;
        seedAmount = derived < fallback * 0.5 ? fallback : derived;
      }

      await db
        .collection<CentralBank>("centralBanks")
        .updateOne({ _id: bankId }, { $set: { reserveBalance: seedAmount, updatedAt: now } });
      seeded[countryId] = seedAmount;
    }

    await createAdminLog({
      category: "system",
      action: "cb_fx_reserve_seed",
      username: auth.admin.username ?? "unknown",
      adminUsername: auth.admin.username ?? undefined,
      details: `Seeded: ${JSON.stringify(seeded)}. Skipped: ${skipped.join(",") || "none"}`,
    });

    return NextResponse.json({ success: true, seeded, skipped });
  } catch (error) {
    return handleRouteError(error);
  }
}
