import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import type { Bond, Corporation } from "@/lib/db/types";
import { BOND_UNIT_FACE_VALUE, BOND_MATURITY_LABELS } from "@/lib/db/types/bond";
import type { BondMaturityTurns } from "@/lib/db/types/bond";
import { getGameState } from "@/lib/gameState";
import { getAuthUser } from "@/lib/auth";
import { getEnabledCountryIds } from "@/lib/countryAccess";
import type { CountryId } from "@/lib/constants/countries";
import { getCountryForExchange } from "@/lib/constants/exchangeRegistry";
import { ObjectId } from "mongodb";
import {
  getBondCountryId,
  getBondIssuerDisplayName,
  isCorporateBond,
  isSovereignBond,
} from "@/lib/bonds/sovereign";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { corpCapitalToAnchor, loadFxRatesByCurrency } from "@/lib/currency/corporationCapital";
import { calculateBondYieldToMaturityPercent } from "@/lib/constants/bonds";
import { conditionalJson } from "@/lib/api/conditionalJson";

/**
 * GET /api/bonds
 * List all active (non-matured) bonds for the stock market bonds tab.
 * Optional query param: ?exchange=nyse|ftse|global (filters by corp HQ country)
 */
export async function GET(request: Request) {
  try {
    const db = await getDb();
    const url = new URL(request.url);
    const exchange = url.searchParams.get("exchange") || "global";

    // Filter by country access: NYSE→US, FTSE→UK
    const authUser = await getAuthUser();
    const isAdmin = authUser?.isAdmin === true;
    if (!isAdmin) {
      const enabledCountries = await getEnabledCountryIds();
      const requiredCountry = exchange ? getCountryForExchange(exchange) : undefined;
      if (requiredCountry && !enabledCountries.includes(requiredCountry as CountryId)) {
        return NextResponse.json({ bonds: [], totalOutstanding: 0 });
      }
    }

    const gameState = await getGameState();
    const currentTurn = gameState?.currentTurn ?? 1;

    // Get all non-matured bonds + FX rates (needed to anchor-normalize the
    // cross-currency `totalOutstanding` summary — A24).
    const [bonds, fxByCurrency] = await Promise.all([
      db
        .collection<Bond>("bonds")
        .find(
          { matured: false },
          {
            // Listing fields only; holders trimmed to units (the map needs the
            // count and the units sum, not full holder entries).
            projection: {
              issuerType: 1,
              countryId: 1,
              currencyCode: 1,
              corporationId: 1,
              issuerName: 1,
              couponRate: 1,
              maturityTurns: 1,
              issuedAtTurn: 1,
              maturityTurn: 1,
              marketPrice: 1,
              totalIssued: 1,
              publicFloat: 1,
              defaulted: 1,
              createdAt: 1,
              "holders.units": 1,
            },
          }
        )
        .sort({ createdAt: -1 })
        .toArray(),
      loadFxRatesByCurrency(db),
    ]);

    if (bonds.length === 0) {
      return NextResponse.json({ bonds: [], totalOutstanding: 0 });
    }

    // Get all issuing corporations
    const corpIds = [
      ...new Set(bonds.filter(isCorporateBond).map((bond) => bond.corporationId.toString())),
    ];
    interface CorpProjection {
      _id: Corporation["_id"];
      name: string;
      sequentialId?: number;
      logoUrl?: string;
      brandColor?: string;
      headquartersState: string;
      countryId: CountryId;
      type: string;
    }
    const corporations = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: corpIds.map((id) => new ObjectId(id)) } })
      .project<CorpProjection>({
        _id: 1,
        name: 1,
        sequentialId: 1,
        logoUrl: 1,
        brandColor: 1,
        headquartersState: 1,
        countryId: 1,
        type: 1,
      })
      .toArray();
    const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));

    // Filter by exchange if specified
    const filteredBonds = bonds.filter((bond) => {
      if (exchange === "global") return true;
      const targetCountry = getCountryForExchange(exchange);
      if (!targetCountry) return true;
      if (isSovereignBond(bond)) {
        const countryId = getBondCountryId(bond);
        return countryId === targetCountry;
      }
      const corp = corpMap.get(bond.corporationId.toString());
      if (!corp) return false;
      // Filter corporate bonds by corporation's countryId
      return corp.countryId === targetCountry;
    });

    // `bond.totalIssued` is LOCAL in `bond.currencyCode` (Task-18B); a raw
    // cross-bond sum would mix currencies (USD + GBP + JPY). Anchor-normalize
    // each bond's contribution so the exchange-wide total is in ₳ and the
    // BondTable listing ships an explicit `currencyCode` per row so the UI
    // can format per-bond correctly. (A24 + supports B10)
    let totalOutstandingAnchor = 0;

    const bondListings = filteredBonds.map((bond) => {
      const corp = corpMap.get(bond.corporationId.toString());
      const turnsRemaining = Math.max(0, bond.maturityTurn - currentTurn);
      const totalUnitsHeld = bond.holders.reduce((sum, h) => sum + h.units, 0);
      const totalUnits = Math.floor(bond.totalIssued / BOND_UNIT_FACE_VALUE);

      const bondCcy = (bond.currencyCode ??
        (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
      totalOutstandingAnchor += corpCapitalToAnchor(bond.totalIssued, bondCcy, bondFxRate);

      // For corporate bonds, use the corporation's countryId (flag / logo only)
      const countryId = isCorporateBond(bond) ? corp?.countryId : bond.countryId;

      return {
        _id: bond._id.toString(),
        issuerType: bond.issuerType ?? "corporation",
        countryId,
        currencyCode: bondCcy ?? null,
        corporationId: bond.corporationId.toString(),
        corporationName: getBondIssuerDisplayName(bond, corp?.name),
        corporationSequentialId: corp?.sequentialId,
        logoUrl: corp?.logoUrl,
        brandColor: corp?.brandColor,
        corporationType: corp?.type,
        pricePerUnit: Math.round(BOND_UNIT_FACE_VALUE * bond.marketPrice * 100) / 100,
        couponRate: bond.couponRate,
        maturityLabel:
          BOND_MATURITY_LABELS[bond.maturityTurns as BondMaturityTurns] ??
          `${bond.maturityTurns} turns`,
        maturityTurns: bond.maturityTurns,
        issuedAtTurn: bond.issuedAtTurn,
        maturityTurn: bond.maturityTurn,
        turnsRemaining,
        marketPrice: bond.marketPrice,
        totalIssued: bond.totalIssued,
        publicFloat: bond.publicFloat,
        totalUnits,
        totalUnitsHeld,
        defaulted: bond.defaulted,
        holders: bond.holders.length,
        yieldToMaturity: calculateBondYieldToMaturityPercent(
          bond.couponRate,
          bond.marketPrice,
          turnsRemaining
        ),
      };
    });

    // Per-user (enabled-country filtered) — ETag/304 saves egress on unchanged
    // polls; not shared-cached to avoid cross-country-access leakage.
    return conditionalJson(request, {
      bonds: bondListings,
      totalOutstanding: totalOutstandingAnchor,
    });
  } catch (error) {
    return handleRouteError(error, { request, route: "/api/bonds" });
  }
}
