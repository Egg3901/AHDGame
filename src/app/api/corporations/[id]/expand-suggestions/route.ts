import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation, requireCeo } from "@/lib/api/corporations/resolveQuery";
import {
  SPLIT_BASE_CAPTURE_FRACTION,
  UNOWNED_CAPTURE_BONUS_MULTIPLIER,
  MS_CAPTURE_DIVISOR,
  CORPORATION_TYPES,
} from "@/lib/constants/corporations";
import type {
  Character,
  CorporateSector,
  GameState,
  StateMetrics,
  UnownedSector,
  State,
  Corporation,
} from "@/lib/db/types";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import type { CommodityType } from "@/lib/constants/commodities";
import { sectorDemandGapUnits } from "@/lib/market/sectorDemandGap";
import { reachableDemandGap } from "@/lib/trade/reachableBook";
import { bookFor, loadReachableBooks } from "@/lib/trade/queries/loadReachableBooks";
import { getStrategy } from "@/lib/constants/sectorStrategies";
import { CAPACITY_BUILD_TURNS, computeBuildCost } from "@/lib/constants/capacityEconomy";
import { foundingStarterUnits, sectorEntryFeeAnchor } from "@/lib/corporations/foundingPlant";
import { resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { getSectorTechEffects } from "@/lib/constants/techTree";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { loadWorldEraUnitScale } from "@/lib/currency/gdpAnchorRate";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { calculateSplitCostAnchor } from "@/lib/corporations/marketActionCosts";
import { loadCommandEconomyBlockedCountries } from "@/lib/economy/queries/commandEconomyMarketGate";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { pinStateInTopSuggestions } from "@/lib/corporations/expandSuggestionPin";

interface RouteParams {
  params: Promise<{ id: string }>;
}

type SuggestionMode = "unowned" | "playerCorp";
type OwnershipFilter = "all" | "owned" | "unowned";

/**
 * GET /api/corporations/[id]/expand-suggestions?sectorType=xxx&mode=unowned|playerCorp&ownership=all|owned|unowned
 * Returns up to 5 states with the best market opportunity for the given sector type.
 * mode=unowned (default): sorted by estimated capture from the unowned pool.
 * mode=playerCorp: sorted by total competitor revenue — markets with active player corps.
 * ownership (default all): owned = only states this corp already operates a sector in;
 *   unowned = only states it has not entered. Applied BEFORE the top-N slice so the
 *   best owned/new markets surface rather than being hidden behind the global top-N.
 * state (optional): pin this stateId into the returned top-N (Build-here deep link).
 * Includes competitor corporations already operating in each state.
 * CEO only.
 */
export async function GET(request: Request, { params }: RouteParams) {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;

    const url = new URL(request.url);
    const sectorType = url.searchParams.get("sectorType") as CorporationType | null;
    const modeParam = url.searchParams.get("mode") ?? "unowned";
    const mode: SuggestionMode = modeParam === "playerCorp" ? "playerCorp" : "unowned";
    const ownershipParam = url.searchParams.get("ownership") ?? "all";
    const ownership: OwnershipFilter =
      ownershipParam === "owned" ? "owned" : ownershipParam === "unowned" ? "unowned" : "all";
    // Optional comma-separated country filter. When set, the top-N is taken
    // WITHIN these countries (revealing markets outside the global top-N);
    // `availableCountries` in the response always lists every country with a
    // market in this sector, so the UI can show all of them regardless.
    const countrySet = new Set(
      (url.searchParams.get("country") ?? "")
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
    );
    // Optional deep-link pin from the state board "Build here" CTA.
    const pinStateId = (url.searchParams.get("state") ?? "").trim() || null;

    if (!sectorType || !(CORPORATION_TYPES as readonly string[]).includes(sectorType)) {
      return NextResponse.json({ error: "Invalid or missing sectorType" }, { status: 400 });
    }

    const { id } = await params;
    const db = await getDb();

    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    const ceoCheck = requireCeo(corporation, auth.user.userId);
    if (ceoCheck) return ceoCheck;

    const plantsMode = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

    // Demand gap for this sector type's output mix, PER COUNTRY (min over legs —
    // the market stops absorbing when the first leg saturates; 0 in a glut). The
    // unowned pool's headroom is claimable market SHARE, not buyers; ranking
    // and labelling it "untapped demand" steered players straight into gluts
    // (ticket #1027 follow-up).
    //
    // Scoped to each candidate market's own REACHABLE book rather than the world
    // aggregate (ticket #1077). The aggregate summed supply behind embargo walls
    // and supply from countries outside COUNTRY_ORDER that trade with nobody, so
    // a market running a real shortage read as a glut and every state on Earth
    // quoted "room for 0". A market a corporation cannot sell into must not
    // suppress the quote for one it can.
    const supplyMix = getStrategy(sectorType, "standard").supply ?? {};
    const reachableBooks = plantsMode ? await loadReachableBooks(db) : null;
    let globalGapFallbackUnits = Number.POSITIVE_INFINITY;
    if (plantsMode && !reachableBooks) {
      // No book persisted yet (world has not run a turn since 1.1.2). Fall back
      // to the previous world-aggregate behaviour rather than reporting no room.
      const priceDocs = await db
        .collection<{ commodity: CommodityType; globalSupply?: number; globalDemand?: number }>(
          "commodityPrices"
        )
        .find({}, { projection: { commodity: 1, globalSupply: 1, globalDemand: 1 } })
        .toArray();
      const balances = new Map(priceDocs.map((p) => [p.commodity, p]));
      globalGapFallbackUnits = sectorDemandGapUnits(supplyMix, (mixCommodity) => {
        const bal = balances.get(mixCommodity);
        return (bal?.globalDemand ?? 0) - (bal?.globalSupply ?? 0);
      });
    }
    const demandGapUnitsByCountry = new Map<string, number>();
    const demandGapUnitsFor = (countryId: string): number => {
      if (!plantsMode) return Number.POSITIVE_INFINITY;
      if (!reachableBooks) return globalGapFallbackUnits;
      const cached = demandGapUnitsByCountry.get(countryId);
      if (cached !== undefined) return cached;
      const gap = sectorDemandGapUnits(supplyMix, (mixCommodity) =>
        reachableDemandGap(bookFor(reachableBooks, countryId, mixCommodity))
      );
      demandGapUnitsByCountry.set(countryId, gap);
      return gap;
    };

    const { ObjectId } = await import("mongodb");
    const ms = corporation.marketingStrength ?? 0;
    const liquidCapital = corporation.liquidCapital ?? 0;
    const captureMultiplier = 1 + ms / MS_CAPTURE_DIVISOR;
    const fxByCurrency = await loadFxRatesByCurrency(db);
    const corpFx = fxRateForCorpFromMap(corporation, fxByCurrency);
    const liquidCurrencyCode = resolveCorpLiquidCurrencyCode(corporation);
    const liquidCapitalAnchor = Math.round(
      corpLiquidCapitalToAnchor(liquidCapital, corporation, corpFx)
    );

    let stateIds: string[];

    if (mode === "playerCorp") {
      // Find states where competitor corps operate in this sector type
      const competitorSectors = await db
        .collection<CorporateSector>("corporateSectors")
        .find({
          sectorType,
          corporationId: { $ne: corporation._id },
        })
        .project<{ stateId: string }>({ stateId: 1 })
        .toArray();

      stateIds = [...new Set(competitorSectors.map((s) => s.stateId))];
    } else {
      // Find states with unowned revenue pools
      const unownedIds = await db
        .collection<UnownedSector>("unownedSectors")
        .find({ sectorType, revenue: { $gt: 0 } })
        .project<{ stateId: string }>({ stateId: 1 })
        .toArray();

      stateIds = [...new Set(unownedIds.map((u) => u.stateId))];
    }

    if (stateIds.length === 0) {
      return NextResponse.json({
        suggestions: [],
        availableCountries: [],
        liquidCapital: liquidCapitalAnchor,
        liquidCurrencyCode,
      });
    }

    // Fetch all relevant data for the candidate states in parallel
    const [states, ownedSectors, siblingCorpSectors, unownedSectors] = await Promise.all([
      db
        .collection<State>("states")
        .find({ _id: { $in: stateIds } }, { projection: { _id: 1, name: 1, countryId: 1 } })
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ corporationId: corporation._id, sectorType, stateId: { $in: stateIds } })
        .project<{ _id: string; stateId: string }>({ _id: 1, stateId: 1 })
        .toArray(),
      db
        .collection<CorporateSector>("corporateSectors")
        .find({ sectorType, stateId: { $in: stateIds } })
        .project<{ corporationId: string; stateId: string; revenue: number }>({
          corporationId: 1,
          stateId: 1,
          revenue: 1,
        })
        .toArray(),
      db
        .collection<UnownedSector>("unownedSectors")
        .find({ sectorType, stateId: { $in: stateIds } })
        .toArray(),
    ]);

    const commandEconomyBlockedCountries =
      mode === "unowned"
        ? await loadCommandEconomyBlockedCountries(
            db,
            states.map((s) => s.countryId)
          )
        : new Set<CountryId>();

    // Fetch competitor corporation details by ObjectId
    const competitorCorpIds = [
      ...new Set(
        siblingCorpSectors
          .filter((s) => s.corporationId.toString() !== corporation._id.toString())
          .map((s) => s.corporationId.toString())
      ),
    ];
    const validCompetitorIds = competitorCorpIds
      .filter((cid) => ObjectId.isValid(cid))
      .map((cid) => new ObjectId(cid));
    const competitorCorpsById =
      validCompetitorIds.length > 0
        ? await db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: validCompetitorIds } })
            .project<{
              _id: { toString(): string };
              name: string;
              sequentialId?: number;
              logoUrl?: string;
              brandColor?: string;
              countryId?: string;
              liquidCurrencyCode?: string;
            }>({
              _id: 1,
              name: 1,
              sequentialId: 1,
              logoUrl: 1,
              brandColor: 1,
              countryId: 1,
              liquidCurrencyCode: 1,
            })
            .toArray()
        : [];
    const corpRefMap = new Map(competitorCorpsById.map((c) => [c._id.toString(), c]));
    const competitorFxByCorpId = new Map(
      competitorCorpsById.map((c) => [
        c._id.toString(),
        {
          code: resolveCorpLiquidCurrencyCode(c),
          rate: fxRateForCorpFromMap(c, fxByCurrency),
        },
      ])
    );

    // Command economies (USSR, East Germany, etc — and China pre-reform when
    // the marketization feature is on) run production through the state, not
    // private corporations. An "unowned" market there isn't a private-capture
    // opportunity, it's a modeling gap — exclude those states from the
    // unowned-mode candidate pool BEFORE building stateMap/availableCountries
    // so neither the suggestions nor the country filter chips surface them.
    // playerCorp mode is untouched — seeing which corps (including SOEs)
    // already compete somewhere is legitimate info either way.
    // Cross-border founding is allowed under plants (as it already was pre-plants):
    // the founding command and buildCapacity both price the host country's prime
    // rate and charge the cross-currency spread, so a foreign market is a real,
    // fully-modelled option. The only hard exclusion is command-economy countries,
    // whose "unowned" markets are a modeling gap rather than a capture opportunity.
    const eligibleStates = states.filter(
      (state) =>
        mode !== "unowned" || !commandEconomyBlockedCountries.has(state.countryId as CountryId)
    );

    // Build lookup maps
    const stateMap = new Map(eligibleStates.map((s) => [s._id, s]));

    // Every country with a candidate market in this sector (pre-filter), so the
    // UI can offer all of them as filter chips, not just the global top-N.
    const availableCountries = [
      ...new Set(eligibleStates.map((s) => s.countryId).filter(Boolean)),
    ].sort();
    const ownedStateMap = new Map(ownedSectors.map((s) => [s.stateId, s._id.toString()]));
    const unownedMap = new Map(unownedSectors.map((u) => [u.stateId, u]));

    // ─── Plants: what entering this market actually costs and delivers ───────
    //
    // Under plants, founding is a FIRST BUILD (see expandSector): an entry fee
    // plus a discounted starter build that ARRIVES after a construction lag.
    // The old modal quoted only a split cost against a ₳ revenue pool, which
    // under plants is neither the price the player pays nor the thing they get.
    //
    // Everything below is priced through the SAME functions expandSector uses
    // — `computeUnownedHeadroomUnits`, `computeBuildCost({ founding: true })`,
    // `CAPACITY_BUILD_TURNS / 2` — so the modal's quote and the command's
    // charge cannot drift. A preview that disagrees with the confirm is worse
    // than no preview.
    const eraUnitScale = await loadWorldEraUnitScale(db);

    let starterUnits = 0;
    let foundingFeeAnchor = 0;
    let foundingBuildTurns = 0;
    const starterBuildCostByState = new Map<string, number>();

    if (plantsMode) {
      const gameState = await db.collection<GameState>("gameState").findOne({ _id: "current" });
      const currentTurn = gameState?.currentTurn ?? 0;
      const currentYear =
        gameState?.currentYear ??
        STARTING_YEAR + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);
      const worldPreset = resolvePresetIdFromGameState(gameState);

      const techEffects = (await isSectorTechTreesEnabled())
        ? getSectorTechEffects(
            {
              type: corporation.type,
              unlockedTechNodeIds: corporation.unlockedTechNodeIds,
              techDecadeLane: corporation.techDecadeLane,
            },
            corporation.type
          )
        : null;
      // Same era-scaled fee + one-facility starter expandSector charges.
      foundingFeeAnchor = sectorEntryFeeAnchor(worldPreset, techEffects?.expansionDiscount ?? 0);
      // Priced for the SELECTED sector type, which is what the player is about
      // to found — not `corporation.type`. Off-primary founding is exactly the
      // case where quoting the wrong type's build turns misleads most.
      starterUnits = foundingStarterUnits(sectorType);
      foundingBuildTurns = Math.max(1, Math.ceil(CAPACITY_BUILD_TURNS(sectorType) / 2));

      const ceoChar = corporation.ceoId
        ? await db
            .collection<Character>("characters")
            .findOne({ _id: corporation.ceoId }, { projection: { "stats.businessAcumen": 1 } })
        : null;
      const acumen = ceoChar?.stats?.businessAcumen ?? NEUTRAL_STAT;

      // Prime rate is per COUNTRY and cost of living per STATE, and both move
      // the build price, so a single blended quote would be wrong in most
      // states. One lookup per unique country, one bulk lookup for the states.
      const uniqueCountryIds = [...new Set(states.map((s) => s.countryId))];
      const primeRateByCountry = new Map<string, number>(
        await Promise.all(
          uniqueCountryIds.map(
            async (c) => [c, await resolveCountryPrimeRate(db, c)] as [string, number]
          )
        )
      );
      const costOfLivingDocs = await db
        .collection<StateMetrics>("macroMetrics")
        .find({ _id: { $in: stateIds } }, { projection: { "economic.costOfLiving": 1 } })
        .toArray();
      const costOfLivingByState = new Map(
        costOfLivingDocs.map((d) => [d._id, d.economic?.costOfLiving?.value ?? null])
      );

      for (const state of states) {
        starterBuildCostByState.set(
          state._id,
          Math.round(
            computeBuildCost({
              sectorType,
              units: starterUnits,
              year: currentYear,
              eraUnitScale,
              // Entering a market this corp does not occupy: dominance is 1 by
              // construction, exactly as expandSector assumes.
              marketSharePercent: 0,
              primeRate: primeRateByCountry.get(state.countryId) ?? 0,
              acumen,
              hostCostOfLivingIndex: costOfLivingByState.get(state._id) ?? null,
              techGrowthCostMultiplier: techEffects?.growthCostMultiplier ?? 1,
              founding: true,
            }).totalAnchor
          )
        );
      }
    }

    // Group siblings by stateId for competitor lookup
    const siblingsByState = new Map<string, typeof siblingCorpSectors>();
    for (const s of siblingCorpSectors) {
      if (!siblingsByState.has(s.stateId)) siblingsByState.set(s.stateId, []);
      siblingsByState.get(s.stateId)!.push(s);
    }

    const ranked = stateIds
      .map((stateId) => {
        const state = stateMap.get(stateId);
        if (!state) return null;

        const unownedDoc = unownedMap.get(stateId);
        const unownedRevenue = Math.round(unownedDoc?.revenue ?? 0);
        // Unowned splits are retired under plants — zero the legacy quote so
        // clients never see a "Split cost" for an action that 403s.
        const splitCost = plantsMode ? 0 : calculateSplitCostAnchor(unownedRevenue);
        const estimatedRevenueCapture = plantsMode
          ? 0
          : Math.min(
              Math.round(
                unownedRevenue *
                  SPLIT_BASE_CAPTURE_FRACTION *
                  captureMultiplier *
                  UNOWNED_CAPTURE_BONUS_MULTIPLIER
              ),
              unownedRevenue
            );
        // Untapped demand, in output units per day. Self-healed from the ₳
        // pool for rows that predate the `headroomUnits` backfill — a bare 0
        // fallback would read as "no demand here" for a market that has plenty.
        const poolHeadroomUnits = plantsMode
          ? unownedDoc?.headroomUnits != null && Number.isFinite(unownedDoc.headroomUnits)
            ? unownedDoc.headroomUnits
            : computeUnownedHeadroomUnits(sectorType, unownedRevenue, eraUnitScale)
          : null;
        // Cap the pool share at what buyers in THIS market can actually absorb —
        // in a glut the pool reads huge while extra output simply goes unsold.
        const headroomUnits =
          poolHeadroomUnits != null
            ? Math.round(Math.min(poolHeadroomUnits, demandGapUnitsFor(state.countryId)))
            : null;
        const starterBuildCostAnchor = plantsMode
          ? (starterBuildCostByState.get(stateId) ?? 0)
          : null;
        // Under plants the price of entry is fee + starter build, not the split
        // cost — so afford must be checked against what is actually charged.
        const foundingTotalAnchor =
          starterBuildCostAnchor == null ? null : foundingFeeAnchor + starterBuildCostAnchor;
        const canAfford =
          foundingTotalAnchor != null
            ? liquidCapitalAnchor >= foundingTotalAnchor
            : splitCost === 0
              ? false
              : liquidCapitalAnchor >= splitCost;
        const ownedSectorId = ownedStateMap.get(stateId) ?? null;

        // Build competitor list for this state
        const stateSiblings = siblingsByState.get(stateId) ?? [];
        const competitors = stateSiblings
          .filter((s) => s.corporationId.toString() !== corporation._id.toString())
          .map((s) => {
            const ref = corpRefMap.get(s.corporationId.toString());
            const fx = competitorFxByCorpId.get(s.corporationId.toString());
            return {
              corpId: s.corporationId.toString(),
              name: ref?.name ?? "Unknown",
              sequentialId: ref?.sequentialId ?? null,
              logoUrl: ref?.logoUrl ?? null,
              brandColor: ref?.brandColor ?? null,
              revenue: Math.round(readCorpEconomicAnchor(s.revenue, fx?.code, fx?.rate ?? 1)),
            };
          });

        const totalCompetitorRevenue = competitors.reduce((sum, c) => sum + c.revenue, 0);

        return {
          stateId,
          stateName: state.name,
          countryId: state.countryId,
          unownedRevenue,
          splitCost,
          estimatedRevenueCapture,
          // Plants-tier fields; null in every other world.
          headroomUnits,
          starterBuildCostAnchor,
          foundingTotalAnchor,
          canAfford,
          ownedSectorId,
          competitors,
          totalCompetitorRevenue,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null)
      // Ownership + country filters apply BEFORE the top-N slice, so a selected
      // country's (or owned/new) best markets surface even if they were outside
      // the global top-N.
      .filter((s) =>
        ownership === "owned"
          ? s.ownedSectorId !== null
          : ownership === "unowned"
            ? s.ownedSectorId === null
            : true
      )
      .filter((s) => countrySet.size === 0 || countrySet.has(s.countryId))
      .sort((a, b) =>
        mode === "playerCorp"
          ? b.totalCompetitorRevenue - a.totalCompetitorRevenue
          : plantsMode
            ? // A market the corporation cannot afford is not the best next
              // sector. Keep affordable markets first, then compare the unmet
              // demand available to the first facility.
              Number(b.canAfford) - Number(a.canAfford) ||
              (b.headroomUnits ?? 0) - (a.headroomUnits ?? 0)
            : b.estimatedRevenueCapture - a.estimatedRevenueCapture
      );
    const suggestions = pinStateInTopSuggestions(ranked, pinStateId, 5);

    return NextResponse.json({
      suggestions,
      availableCountries,
      liquidCapital: liquidCapitalAnchor,
      liquidCurrencyCode,
      // Plants-tier founding quote. Constant across states, unlike the build
      // cost, so it rides on the envelope rather than being repeated per row.
      plantsMode,
      starterUnits: plantsMode ? Math.round(starterUnits) : null,
      foundingFeeAnchor: plantsMode ? foundingFeeAnchor : null,
      foundingBuildTurns: plantsMode ? foundingBuildTurns : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
