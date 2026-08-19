// GET /api/admin/economy/stock-market
// Returns all corporations with aggregated sector revenue and market-cap summary.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import { countryIdSchema } from "@/lib/api/schemas/country";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CurrencyCode } from "@/lib/constants/currencies";

export async function GET(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const rawCountry = searchParams.get("countryId");

    const db = await getDb();
    const corpFilter: Record<string, unknown> = {};
    if (rawCountry) {
      const parsed = countryIdSchema.safeParse(rawCountry);
      if (!parsed.success)
        return NextResponse.json({ error: "Invalid countryId" }, { status: 400 });
      corpFilter.countryId = parsed.data;
    }

    const [corps, sectors, fxByCurrency] = await Promise.all([
      db.collection<Corporation>("corporations").find(corpFilter).toArray(),
      db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
      loadFxRatesByCurrency(db),
    ]);

    // Per-corp currency + FX lookup — sector.revenue / sharePrice / liquidCapital
    // all denominate in each corp's own currency (v0.2.6). Cross-corp totals must
    // anchor-normalize; per-corp row values stay in the corp's local currency.
    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const c of corps) {
      fxByCorpId.set(c._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(c),
        rate: fxRateForCorpFromMap(c, fxByCurrency),
      });
    }

    // Aggregate sector revenue per corporation in the corp's own currency
    const revenueMap = new Map<string, number>();
    for (const s of sectors) {
      const key = s.corporationId.toString();
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + s.revenue);
    }

    const rows = corps.map((c) => {
      const id = c._id.toString();
      const revenue = revenueMap.get(id) ?? 0;
      const marketCap = c.totalShares * c.sharePrice;
      const fx = fxByCorpId.get(id);
      const marketCapAnchor = readCorpEconomicAnchor(marketCap, fx?.code, fx?.rate ?? 1);
      const revenueAnchor = readCorpEconomicAnchor(revenue, fx?.code, fx?.rate ?? 1);
      return {
        id,
        name: c.name,
        countryId: c.countryId,
        type: c.type,
        marketCap,
        marketCapAnchor,
        sharePrice: c.sharePrice,
        revenue,
        revenueAnchor,
        liquidCurrencyCode: c.liquidCurrencyCode ?? null,
        ceoVacant: c.ceoVacant ?? false,
        suspended: c.suspended ?? false,
        bondDefaultActive: c.bondDefaultCreditPenaltyUntilTurn != null,
        liquidCapital: c.liquidCapital,
      };
    });

    // Cross-corp totals must sum in ₳ — marketCap and revenue are per-corp local.
    const totalMarketCap = rows.reduce((s, r) => s + r.marketCapAnchor, 0);
    const totalRevenue = rows.reduce((s, r) => s + r.revenueAnchor, 0);
    const ceoVacancies = rows.filter((r) => r.ceoVacant).length;
    const suspendedCount = rows.filter((r) => r.suspended).length;

    return NextResponse.json({
      summary: {
        total: rows.length,
        totalMarketCap,
        totalRevenue,
        ceoVacancies,
        suspended: suspendedCount,
      },
      corporations: rows,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
