import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import type { Corporation, CorporateSector, State, UnownedSector, User } from "@/lib/db/types";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  SECTOR_MARKET_GDP_FRACTION,
  SECTOR_TYPE_COUNT,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { COUNTRY_ORDER, type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { COUNTRY_CURRENCY_MAP, type CurrencyCode } from "@/lib/constants/currencies";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";

const PAGE_SIZE = 15;

const COUNTRY_IDS: CountryId[] = [...COUNTRY_ORDER];

function roundMarketSharePercent(revenue: number, totalMarket: number): number {
  if (totalMarket <= 0) return 0;
  return Math.min(100, Math.round((revenue / totalMarket) * 10000) / 100);
}

// GET /api/discord-bot/marketshare — Returns corporate market share for a given sector type, optionally scoped by country or state.
// Auth: requireAdminOrApiKey
// Errors: 400, 401, 404
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:marketshare",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const sectorType = url.searchParams.get("type") as CorporationType | null;
    const countryParam = url.searchParams.get("country") as CountryId | null;
    const stateIdParam = url.searchParams.get("state");
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const discordIdParam = url.searchParams.get("discordId");

    if (!sectorType || !CORPORATION_TYPES.includes(sectorType)) {
      return NextResponse.json(
        {
          error: `Must provide a valid type. Options: ${CORPORATION_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    if (countryParam && !COUNTRY_IDS.includes(countryParam)) {
      return NextResponse.json(
        { error: `Invalid country. Options: ${COUNTRY_IDS.join(", ")}` },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Look up the Discord user's home country currency for default display in the bot.
    let suggestedCurrencyCode: string | null = null;
    if (discordIdParam) {
      const linkedUser = await db
        .collection<User>("users")
        .findOne({ discordId: discordIdParam }, { projection: { accountCountryId: 1 } });
      if (linkedUser?.accountCountryId) {
        suggestedCurrencyCode = COUNTRY_CURRENCY_MAP[linkedUser.accountCountryId] ?? null;
      }
    }

    const allStates = await db
      .collection<State>("states")
      .find({})
      .project<{ _id: string; name: string; gdp: number; countryId: CountryId }>({
        _id: 1,
        name: 1,
        gdp: 1,
        countryId: 1,
      })
      .toArray();

    const stateById = new Map(allStates.map((s) => [s._id, s]));

    let scopedStates: typeof allStates;
    let scopeStateName: string | null = null;

    if (stateIdParam) {
      const st = stateById.get(stateIdParam);
      if (!st) {
        return NextResponse.json({ error: "State not found", found: false }, { status: 404 });
      }
      const stateCountry = st.countryId;
      if (countryParam && stateCountry !== countryParam) {
        return NextResponse.json(
          {
            error: `State ${stateIdParam} is not in country ${countryParam}`,
            found: false,
          },
          { status: 400 }
        );
      }
      scopedStates = [st];
      scopeStateName = st.name;
    } else if (countryParam) {
      scopedStates = allStates.filter((s) => s.countryId === countryParam);
    } else {
      scopedStates = allStates;
    }

    const scopedStateIds = new Set(scopedStates.map((s) => s._id));

    // GDP-derived fallback per state, used only when that state has no persisted
    // unowned sector doc for this sectorType. When present, the persisted pool is
    // authoritative — it grows alongside corporate sectors so effectiveMarket stays
    // ≥ ownedRevenue by construction, which keeps market-share percentages ≤ 100%.
    // Matches the precedent in /api/country/.../economy and /api/corporations/.../sectors.
    // Era-scoped GDP→₳ rate (refs #3778).
    const worldPreset = await loadWorldPreset(db);
    const gdpFallbackForState = (gdp: number, countryId: CountryId) =>
      Math.round(
        (gdp * getGdpAnchorRate(countryId, worldPreset) * SECTOR_MARKET_GDP_FRACTION) /
          SECTOR_TYPE_COUNT
      );

    const [sectorsInScope, unownedInScope, fxByCurrency] = await Promise.all([
      db
        .collection<CorporateSector>("corporateSectors")
        .find({
          sectorType,
          stateId: { $in: [...scopedStateIds] },
        })
        .toArray(),
      db
        .collection<UnownedSector>("unownedSectors")
        .find({
          sectorType,
          stateId: { $in: [...scopedStateIds] },
        })
        .toArray(),
      loadFxRatesByCurrency(db),
    ]);

    const corpIds = [...new Set(sectorsInScope.map((sec) => sec.corporationId.toString()))]
      .filter((id) => ObjectId.isValid(id))
      .map((id) => new ObjectId(id));

    const corporations =
      corpIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: corpIds } })
            .project<
              {
                _id: import("mongodb").ObjectId;
                name: string;
                sequentialId?: number;
                brandColor?: string;
                countryOwnerId?: CountryId;
              } & CorpCapitalCurrencyInfo
            >({
              _id: 1,
              name: 1,
              sequentialId: 1,
              brandColor: 1,
              countryOwnerId: 1,
              countryId: 1,
              liquidCurrencyCode: 1,
            })
            .toArray()
        : [];

    const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));
    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const corp of corporations) {
      fxByCorpId.set(corp._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(corp),
        rate: fxRateForCorpFromMap(corp, fxByCurrency),
      });
    }

    const revenueByCorp = new Map<string, number>();
    const revenueAnchorByCorp = new Map<string, number>();
    const ownedRevenueAnchorByState = new Map<string, number>();
    for (const sec of sectorsInScope) {
      const id = sec.corporationId.toString();
      revenueByCorp.set(id, (revenueByCorp.get(id) ?? 0) + sec.revenue);
      const fx = fxByCorpId.get(id);
      const revenueAnchor = readCorpEconomicAnchor(sec.revenue, fx?.code, fx?.rate ?? 1);
      revenueAnchorByCorp.set(id, (revenueAnchorByCorp.get(id) ?? 0) + revenueAnchor);
      ownedRevenueAnchorByState.set(
        sec.stateId,
        (ownedRevenueAnchorByState.get(sec.stateId) ?? 0) + revenueAnchor
      );
    }

    const unownedRevenueByState = new Map<string, number>();
    for (const u of unownedInScope) {
      unownedRevenueByState.set(u.stateId, u.revenue);
    }

    let totalMarket = 0;
    let totalUnownedFromPools = 0;
    for (const s of scopedStates) {
      const ownedRev = ownedRevenueAnchorByState.get(s._id) ?? 0;
      const persistedUnowned = unownedRevenueByState.get(s._id);
      if (persistedUnowned !== undefined) {
        totalMarket += Math.max(0, ownedRev + persistedUnowned);
        totalUnownedFromPools += persistedUnowned;
      } else {
        // No persisted unowned pool for this state+sector; use the GDP-derived reference.
        totalMarket += gdpFallbackForState(s.gdp, s.countryId);
      }
    }

    type Row = {
      corporationId: string;
      corporationName: string;
      corporationSequentialId: number | null;
      brandColor: string | null;
      countryId: string | null;
      liquidCurrencyCode: string | null;
      revenue: number;
      revenueAnchor: number;
      marketSharePercent: number;
      isNatcorp: boolean;
    };

    const companies: Row[] = [];
    let totalOwnedRevenue = 0;

    for (const [corpId, revenue] of revenueByCorp) {
      const raw = Math.round(revenue);
      const corp = corpMap.get(corpId);
      const revenueAnchor = revenueAnchorByCorp.get(corpId) ?? 0;
      totalOwnedRevenue += revenueAnchor;
      companies.push({
        corporationId: corpId,
        corporationName: corp?.name ?? "Unknown",
        corporationSequentialId: corp?.sequentialId ?? null,
        brandColor: corp?.brandColor ?? null,
        countryId: corp?.countryId ?? null,
        liquidCurrencyCode: resolveCorpLiquidCurrencyCode(corp) ?? null,
        revenue: raw,
        // Placeholder — recalculated below once totalOwnedRevenue is known.
        revenueAnchor: Math.round(revenueAnchor),
        marketSharePercent: 0,
        isNatcorp: !!corp?.countryOwnerId,
      });
    }

    // Use max(totalMarket, totalOwnedRevenue) as the denominator so individual
    // percentages always sum to ≤ 100% even when corp revenues have grown past
    // the GDP-derived market cap.
    const effectiveMarket = Math.max(totalMarket, totalOwnedRevenue);
    for (const company of companies) {
      company.marketSharePercent = roundMarketSharePercent(company.revenueAnchor, effectiveMarket);
    }

    companies.sort(
      (a, b) => b.marketSharePercent - a.marketSharePercent || b.revenueAnchor - a.revenueAnchor
    );

    // Prefer the sum of persisted unowned pools (authoritative) when any exist in scope.
    // Fall back to the GDP-gap derivation when no pool is seeded — matches how the state
    // economy API treats it.
    const unownedRevenue =
      unownedInScope.length > 0
        ? Math.max(0, Math.round(totalUnownedFromPools))
        : Math.max(0, totalMarket - totalOwnedRevenue);
    const unownedPercent = roundMarketSharePercent(unownedRevenue, effectiveMarket);

    const totalItems = companies.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages);
    const start = (clampedPage - 1) * PAGE_SIZE;
    const pageCompanies = companies.slice(start, start + PAGE_SIZE);

    const resolvedCountry = countryParam ?? (stateIdParam ? scopedStates[0]?.countryId : null);

    return NextResponse.json({
      found: totalItems > 0 || totalMarket > 0,
      sectorType,
      sectorLabel: CORPORATION_TYPE_LABELS[sectorType],
      scope: {
        country: resolvedCountry,
        stateId: stateIdParam,
        stateName: scopeStateName,
      },
      totalMarket: Math.round(totalMarket),
      totalOwnedRevenue: Math.round(totalOwnedRevenue),
      unownedRevenue: Math.round(unownedRevenue),
      unownedPercent,
      page: clampedPage,
      totalPages,
      totalItems,
      pageSize: PAGE_SIZE,
      companies: pageCompanies,
      suggestedCurrencyCode,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
