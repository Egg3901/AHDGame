// GET /api/admin/bonds
// Returns all non-defaulted bonds with summary stats.
// Query: ?type=sovereign|corporate, ?countryId=US|UK|...
// Auth: requireAdmin
// Errors: 403

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { withAdminAuth } from "@/lib/api/withAdminAuth";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, GameState } from "@/lib/db/types";
import { corpCapitalToAnchor, loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";

export const GET = withAdminAuth(async (_auth, request: Request) => {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get("type"); // "sovereign" | "corporate"
    const countryFilter = searchParams.get("countryId");

    const db = await getDb();
    const filter: Record<string, unknown> = { defaulted: false };
    if (typeFilter) filter.issuerType = typeFilter;
    if (countryFilter) filter.countryId = countryFilter;

    const [bonds, gameState, fxByCurrency] = await Promise.all([
      db.collection<Bond>("bonds").find(filter).toArray(),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentTurn: 1 } }),
      loadFxRatesByCurrency(db),
    ]);

    const currentTurn = gameState?.currentTurn ?? 0;

    // Per-bond `currencyCode` resolution for cross-currency aggregation. Each
    // bond's `faceValue × publicFloat` and coupon dollar amounts are LOCAL in
    // `bond.currencyCode` (Task-18B); summary totals must anchor-normalize
    // before summing or the aggregate mixes currencies (e.g. ¥ + $ + £). (A18)
    const enriched = bonds.map((b) => {
      const bondCcy = (b.currencyCode ??
        (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      const outstandingLocal = b.faceValue * b.publicFloat;
      const annualCouponLocal = outstandingLocal * (b.couponRate / 100);
      return {
        bond: b,
        bondCcy,
        bondFxRate,
        outstandingAnchor: corpCapitalToAnchor(outstandingLocal, bondCcy, bondFxRate),
        annualCouponAnchor: corpCapitalToAnchor(annualCouponLocal, bondCcy, bondFxRate),
      };
    });

    const rows = enriched.map(({ bond: b, bondCcy }) => ({
      id: b._id.toString(),
      issuerName: b.issuerName ?? "Unknown",
      countryId: b.countryId ?? null,
      currencyCode: bondCcy ?? null,
      issuerType: b.issuerType ?? "corporate",
      faceValue: b.faceValue,
      marketPrice: b.marketPrice,
      couponRate: b.couponRate,
      publicFloat: b.publicFloat,
      holderCount: b.holders?.length ?? 0,
      maturityTurn: b.maturityTurn,
      turnsToMaturity: b.maturityTurn - currentTurn,
      issuedAtTurn: b.issuedAtTurn,
      matured: b.matured,
      defaulted: b.defaulted,
    }));

    const summary = {
      activeBonds: rows.length,
      sovereignCount: rows.filter((r) => r.issuerType === "sovereign").length,
      corporateCount: rows.filter((r) => r.issuerType === "corporate").length,
      totalOutstanding: enriched.reduce((s, e) => s + e.outstandingAnchor, 0),
      annualCouponBurden: enriched.reduce((s, e) => s + e.annualCouponAnchor, 0),
      maturingNext12t: rows.filter((r) => r.turnsToMaturity <= 12 && r.turnsToMaturity >= 0).length,
    };

    return NextResponse.json({ summary, bonds: rows, currentTurn });
  } catch (error) {
    return handleRouteError(error);
  }
});
