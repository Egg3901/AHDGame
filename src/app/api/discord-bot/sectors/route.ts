import { loadWorkforceSkillByState } from "@/lib/politicalLegislation/workforceSkillLoader";
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { handleRouteError } from "@/lib/api/errors";
import { requireBotToken } from "@/lib/api/requireBotToken";
import { checkRateLimit, rateLimitResponse, BOT_FINANCIAL_LIMITS } from "@/lib/api/rateLimit";
import type {
  Corporation,
  CorporateSector,
  State,
  StateMetrics,
  UnownedSector,
} from "@/lib/db/types";
import {
  CORPORATION_TYPES,
  CORPORATION_TYPE_LABELS,
  SECTOR_MARKET_GDP_FRACTION,
  SECTOR_TYPE_COUNT,
  calculateWorkers,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { type CountryId } from "@/lib/constants/countries";
import { getGdpAnchorRate, loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import type { CurrencyCode } from "@/lib/constants/currencies";

const PAGE_SIZE = 10;

// GET /api/discord-bot/sectors — Returns paginated corporate sector data for a given type; supports owned and unowned market modes.
// Auth: requireAdminOrApiKey
// Errors: 400, 401
export async function GET(request: Request) {
  try {
    if (!requireBotToken(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateLimit = checkRateLimit(
      "discord-bot:sectors",
      BOT_FINANCIAL_LIMITS.maxRequests,
      BOT_FINANCIAL_LIMITS.windowMs
    );
    if (!rateLimit.ok) return rateLimitResponse(rateLimit.retryAfter);

    const url = new URL(request.url);
    const sectorType = url.searchParams.get("type") as CorporationType | null;
    const unowned = url.searchParams.get("unowned") === "true";
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));

    if (!sectorType || !CORPORATION_TYPES.includes(sectorType)) {
      return NextResponse.json(
        {
          error: `Must provide a valid type. Options: ${CORPORATION_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const db = await getDb();

    if (unowned) {
      // Compute unowned market per state for this sector type
      // 1. Get all states with GDP
      const states = await db
        .collection<State>("states")
        .find({})
        .project<{
          _id: string;
          name: string;
          gdp: number;
          countryId: CountryId;
        }>({ _id: 1, name: 1, gdp: 1, countryId: 1 })
        .toArray();

      // 2. Get owned + persisted unowned sectors of this type + currency info for anchor
      // normalization. The persisted `unownedSectors` pool is authoritative (it grows
      // alongside owned sectors); the GDP-derived formula is only a fallback for
      // state+sector combos that have never been seeded. Matches the pattern in
      // /api/discord-bot/marketshare and /api/corporations/.../sectors.
      const [ownedSectors, persistedUnowned, fxByCurrency, worldPreset] = await Promise.all([
        db.collection<CorporateSector>("corporateSectors").find({ sectorType }).toArray(),
        db.collection<UnownedSector>("unownedSectors").find({ sectorType }).toArray(),
        loadFxRatesByCurrency(db),
        loadWorldPreset(db),
      ]);
      const ownerCorpIds = Array.from(new Set(ownedSectors.map((s) => s.corporationId.toString())));
      const ownerObjectIds = ownerCorpIds
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
      const ownerCorps =
        ownerObjectIds.length > 0
          ? await db
              .collection<Corporation>("corporations")
              .find({ _id: { $in: ownerObjectIds } })
              .project<{ _id: ObjectId } & CorpCapitalCurrencyInfo>({
                _id: 1,
                countryId: 1,
                liquidCurrencyCode: 1,
              })
              .toArray()
          : [];
      const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
      for (const c of ownerCorps) {
        fxByCorpId.set(c._id.toString(), {
          code: resolveCorpLiquidCurrencyCode(c),
          rate: fxRateForCorpFromMap(c, fxByCurrency),
        });
      }

      // Sum owned revenue per state in ₳ (cross-corp, heterogeneous currencies)
      const ownedByState = new Map<string, number>();
      for (const s of ownedSectors) {
        const fx = fxByCorpId.get(s.corporationId.toString());
        const revenueAnchor = readCorpEconomicAnchor(s.revenue, fx?.code, fx?.rate ?? 1);
        ownedByState.set(s.stateId, (ownedByState.get(s.stateId) ?? 0) + revenueAnchor);
      }

      // unownedSectors.revenue is ₳-native (Task 9 — cross-corp shed normalizes on write)
      // so it sums directly with the ₳ owned anchors above.
      const persistedUnownedByState = new Map<string, number>();
      for (const u of persistedUnowned) {
        persistedUnownedByState.set(u.stateId, u.revenue);
      }

      // Compute unowned for each state. Prefer the persisted pool when present; only
      // fall back to the GDP-derived market when no pool has been seeded for this
      // state+sector combo.
      const unownedList = states
        .map((state) => {
          const owned = ownedByState.get(state._id) ?? 0;
          const persisted = persistedUnownedByState.get(state._id);
          let totalMarket: number;
          let unownedRevenue: number;
          if (persisted !== undefined) {
            unownedRevenue = Math.max(0, persisted);
            totalMarket = Math.max(0, owned + unownedRevenue);
          } else {
            // Era-scoped GDP→₳ rate (refs #3778).
            const usdExchangeRate = getGdpAnchorRate(state.countryId, worldPreset);
            totalMarket = Math.round(
              (state.gdp * usdExchangeRate * SECTOR_MARKET_GDP_FRACTION) / SECTOR_TYPE_COUNT
            );
            unownedRevenue = Math.max(0, totalMarket - owned);
          }
          return {
            stateId: state._id,
            stateName: state.name,
            countryId: state.countryId,
            totalMarket: Math.round(totalMarket),
            ownedRevenue: Math.round(owned),
            unownedRevenue: Math.round(unownedRevenue),
          };
        })
        .filter((s) => s.unownedRevenue > 0)
        .sort((a, b) => b.unownedRevenue - a.unownedRevenue);

      const totalItems = unownedList.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
      const clampedPage = Math.min(page, totalPages);
      const start = (clampedPage - 1) * PAGE_SIZE;
      const pageItems = unownedList.slice(start, start + PAGE_SIZE);

      return NextResponse.json({
        found: pageItems.length > 0,
        mode: "unowned",
        sectorType,
        sectorLabel: CORPORATION_TYPE_LABELS[sectorType],
        page: clampedPage,
        totalPages,
        totalItems,
        sectors: pageItems,
      });
    }

    // Owned mode: list all corporate sectors of this type, sorted by revenue in ₳.
    // Can't use db-level .sort({ revenue: -1 }) — sector.revenue is per-corp local
    // (v0.2.6), so comparing raw magnitudes mixes currencies. Fetch all, resolve
    // FX per corp, sort by anchor revenue, paginate in memory.
    const allSectors = await db
      .collection<CorporateSector>("corporateSectors")
      .find({ sectorType })
      .toArray();

    const totalItems = allSectors.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages);

    if (allSectors.length === 0) {
      return NextResponse.json({
        found: false,
        mode: "owned",
        sectorType,
        sectorLabel: CORPORATION_TYPE_LABELS[sectorType],
        page: 1,
        totalPages: 1,
        totalItems: 0,
        sectors: [],
      });
    }

    // Resolve corporation (with currency info) and state names
    const corpIds = [...new Set(allSectors.map((s) => s.corporationId))];
    const stateIds = [...new Set(allSectors.map((s) => s.stateId))];

    const [corporations, states, workforceSkillMap, fxByCurrency] = await Promise.all([
      db
        .collection<Corporation>("corporations")
        .find({ _id: { $in: corpIds } })
        .project<
          {
            _id: ObjectId;
            name: string;
            brandColor?: string;
            sequentialId?: number;
          } & CorpCapitalCurrencyInfo
        >({
          _id: 1,
          name: 1,
          brandColor: 1,
          sequentialId: 1,
          countryId: 1,
          liquidCurrencyCode: 1,
        })
        .toArray(),
      db
        .collection<State>("states")
        .find({ _id: { $in: stateIds } })
        .project<{ _id: string; name: string }>({ _id: 1, name: 1 })
        .toArray(),
      // SP4: merged legacy + political-board read so playable regions' worker
      // counts keep matching the turn's adapter-fed values.
      loadWorkforceSkillByState(db, stateIds),
      loadFxRatesByCurrency(db),
    ]);

    const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));
    const stateMap = new Map(states.map((s) => [s._id, s.name]));

    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const c of corporations) {
      fxByCorpId.set(c._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(c),
        rate: fxRateForCorpFromMap(c, fxByCurrency),
      });
    }

    // Rank every sector by revenueAnchor (₳-comparable), then paginate.
    const rankedSectors = allSectors
      .map((s) => {
        const fx = fxByCorpId.get(s.corporationId.toString());
        return {
          sector: s,
          revenueAnchor: readCorpEconomicAnchor(s.revenue, fx?.code, fx?.rate ?? 1),
          liquidCurrencyCode: fx?.code ?? null,
        };
      })
      .sort((a, b) => b.revenueAnchor - a.revenueAnchor);

    const start = (clampedPage - 1) * PAGE_SIZE;
    const pageItems = rankedSectors.slice(start, start + PAGE_SIZE);

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://ahousedividedgame.com";
    const sectorResults = pageItems.map(({ sector: s, revenueAnchor, liquidCurrencyCode }) => {
      const corp = corpMap.get(s.corporationId.toString());
      return {
        stateId: s.stateId,
        stateName: stateMap.get(s.stateId) ?? s.stateId,
        corporationId: s.corporationId.toString(),
        corporationName: corp?.name ?? "Unknown",
        brandColor: corp?.brandColor ?? null,
        countryId: corp?.countryId ?? null,
        corporationSequentialId: corp?.sequentialId ?? null,
        // revenue stays in the corp's own currency — pair with liquidCurrencyCode
        // for display. revenueAnchor is exposed for cross-corp comparisons.
        revenue: Math.round(s.revenue),
        revenueAnchor: Math.round(revenueAnchor),
        liquidCurrencyCode,
        currentGrowthRate: s.currentGrowthRate ?? s.growthRate ?? 0,
        workers: calculateWorkers(s.revenue, workforceSkillMap.get(s.stateId) ?? null),
        // URLs for linking
        sectorUrl: `${baseUrl}/corporation/${corp?.sequentialId ?? corp?._id}/sector/${s._id}`,
        corporationUrl: `${baseUrl}/corporation/${corp?.sequentialId ?? corp?._id}`,
        stateUrl: `${baseUrl}/state/${s.stateId}`,
      };
    });

    return NextResponse.json({
      found: true,
      mode: "owned",
      sectorType,
      sectorLabel: CORPORATION_TYPE_LABELS[sectorType],
      page: clampedPage,
      totalPages,
      totalItems,
      sectors: sectorResults,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
