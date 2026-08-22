// GET /api/admin/corporations
// Returns all corporations with aggregated sector revenue, CEO name, and timer state.
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { handleRouteError } from "@/lib/api/errors";
import type { Corporation, CorporateSector, Character, GameState } from "@/lib/db/types";
import {
  corpCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CurrencyCode } from "@/lib/constants/currencies";

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const db = await getDb();
    const [corps, sectors, characters, gameState, fxByCurrency] = await Promise.all([
      db.collection<Corporation>("corporations").find({}).toArray(),
      db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
      db
        .collection<Character>("characters")
        .find({}, { projection: { _id: 1, name: 1 } })
        .toArray(),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      loadValuationFxRates(db),
    ]);
    const currentTurn = gameState?.currentTurn ?? 0;

    // Per-corp currency + FX lookup — sector.revenue, sharePrice, liquidCapital
    // are each stored in the corp's liquidCurrencyCode (v0.2.6). Row values stay
    // local; the summary totalLiquidCapital sums in ₳ across heterogeneous corps.
    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const c of corps) {
      fxByCorpId.set(c._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(c),
        rate: fxRateForCorpFromMap(c, fxByCurrency),
      });
    }

    // Aggregate sector revenue per corporation in each corp's own currency
    const revenueMap = new Map<string, number>();
    for (const s of sectors) {
      const key = s.corporationId.toString();
      revenueMap.set(key, (revenueMap.get(key) ?? 0) + s.revenue);
    }

    const charMap = new Map(characters.map((c) => [c._id.toString(), c.name]));

    const rows = corps.map((c) => {
      const id = c._id.toString();
      const revenueLocal = revenueMap.get(id) ?? 0;
      const fx = fxByCorpId.get(id);
      return {
        id,
        name: c.name,
        countryId: c.countryId,
        headquartersState: c.headquartersState,
        type: c.type,
        ceoId: c.ceoId?.toString() ?? null,
        ceoName: c.ceoId ? (charMap.get(c.ceoId.toString()) ?? "Unknown") : null,
        ceoVacant: c.ceoVacant ?? false,
        ceoVacantSinceTurn: c.ceoVacantSinceTurn ?? null,
        suspended: c.suspended ?? false,
        suspendedUntilTurn: c.suspendedUntilTurn ?? null,
        liquidCapital: c.liquidCapital,
        liquidCapitalAnchor: corpCapitalToAnchor(c.liquidCapital, fx?.code, fx?.rate ?? 1),
        liquidCurrencyCode: c.liquidCurrencyCode ?? null,
        revenue: revenueLocal,
        revenueAnchor: readCorpEconomicAnchor(revenueLocal, fx?.code, fx?.rate ?? 1),
        dividendRate: c.dividendRate ?? 0,
        sharePrice: c.sharePrice,
        totalShares: c.totalShares,
        lastDividendChange: c.lastDividendChange ?? null,
        creditRatingSnapshot: c.creditRatingSnapshot ?? null,
        bondDefaultCreditPenaltyUntilTurn: c.bondDefaultCreditPenaltyUntilTurn ?? null,
        imfBailoutActive: c.imfBailoutActive ?? false,
        imfFacilityPrincipalOutstanding: c.imfFacilityPrincipalOutstanding ?? null,
        imfFacilityAmortizationTurnsRemaining: c.imfFacilityAmortizationTurnsRemaining ?? null,
        imfFacilityIncomeCaptureFraction: c.imfFacilityIncomeCaptureFraction ?? null,
        imfFacilityAnnualRate: c.imfFacilityAnnualRate ?? null,
        imfInstitution: c.imfInstitution ?? false,
      };
    });

    // Cross-corp totalLiquidCapital must sum in ₳ — each row.liquidCapital is local.
    const summary = {
      total: rows.length,
      active: rows.filter((r) => !r.suspended).length,
      suspended: rows.filter((r) => r.suspended).length,
      ceoVacancies: rows.filter((r) => r.ceoVacant).length,
      totalLiquidCapital: rows.reduce((s, r) => s + r.liquidCapitalAnchor, 0),
    };

    return NextResponse.json({ summary, corporations: rows, currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
}
