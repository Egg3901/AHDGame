// GET /api/actions/recommendations - Returns personalized action recommendations for the authenticated user
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { requireBasicAuth } from "@/lib/api/requireAuth";
import { handleRouteError } from "@/lib/api/errors";
import { getGameState } from "@/lib/gameState";
import { generateRecommendations } from "@/lib/actions/recommendations";
import { hasVotedOnAnyBill } from "@/lib/onboarding/checklist";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { getCharacterByUserId } from "@/lib/db/characterLookup";
import type {
  Character,
  State,
  PartyBudget,
  PoliticalParty,
  StatePartyOrg,
  Corporation,
} from "@/lib/db/types";
import type { ElectionCandidate } from "@/lib/db/types/election";
import { type CountryId } from "@/lib/constants/countries";
import { findPartyBudgetForScope } from "@/lib/partyBudgetGuards";
import {
  fxRateForCorpFromMap,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  type CorpCapitalCurrencyInfo,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import type { CurrencyCode } from "@/lib/constants/currencies";

interface StateEconomySector {
  type: string;
  label: string;
  totalMarket: number;
  ownedRevenue: number;
  unownedRevenue: number;
  unownedPercent: number;
  splitCost: number;
  estimatedCapture: number;
  estimatedCapturePercent: number;
}

interface StateEconomyData {
  stateId: string;
  stateName: string;
  countryId: CountryId;
  sectors: StateEconomySector[];
}

interface CorpMarketPosition {
  corporationId: string;
  corporationName: string;
  sectorId: string;
  revenue: number;
  marketSharePercent: number;
  sectorType: string;
  stateId: string;
  avgMarketShare: number;
}

/**
 * Fetch economy data for a state (unowned sectors breakdown).
 */
async function fetchStateEconomy(
  db: Awaited<ReturnType<typeof getDb>>,
  stateId: string,
  stateName: string,
  countryId: CountryId
): Promise<StateEconomyData> {
  const state = await db.collection<State>("states").findOne({ _id: stateId, countryId });
  if (!state) {
    return { stateId, stateName, countryId, sectors: [] };
  }

  const sectors = await db
    .collection<{
      corporationId: ObjectId;
      sectorType: string;
      revenue: number;
    }>("corporateSectors")
    .find({ stateId })
    .toArray();

  const unownedSectors = await db
    .collection<{ sectorType: string; revenue: number }>("unownedSectors")
    .find({ stateId })
    .toArray();

  // unownedSectors.revenue is always ₳ (cross-corp shed normalizes on write);
  // corporateSectors.revenue is in each corp's liquidCurrencyCode as of v0.2.6
  // and must be anchor-normalized before being summed with unowned in each state.
  const corpIdsInState = Array.from(new Set(sectors.map((s) => s.corporationId.toString())));
  const corpIds = corpIdsInState.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
  const [corpsForFx, fxByCurrency] = await Promise.all([
    corpIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: corpIds } })
          .project<{ _id: ObjectId } & CorpCapitalCurrencyInfo>({
            _id: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
          })
          .toArray()
      : Promise.resolve([]),
    loadFxRatesByCurrency(db),
  ]);
  const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
  for (const c of corpsForFx) {
    fxByCorpId.set(c._id.toString(), {
      code: resolveCorpLiquidCurrencyCode(c),
      rate: fxRateForCorpFromMap(c, fxByCurrency),
    });
  }

  const unownedMap = new Map(
    unownedSectors.map((u: { sectorType: string; revenue: number }) => [u.sectorType, u.revenue])
  );
  const ownedByType = new Map<string, number>();

  for (const sector of sectors) {
    const fx = fxByCorpId.get(sector.corporationId.toString());
    const revenueAnchor = readCorpEconomicAnchor(sector.revenue, fx?.code, fx?.rate ?? 1);
    const current = ownedByType.get(sector.sectorType) ?? 0;
    ownedByType.set(sector.sectorType, current + revenueAnchor);
  }

  const sectorTypes = [
    "agriculture",
    "energy",
    "materials",
    "manufacturing",
    "construction",
    "defense",
    "technology",
    "transportation",
    "logistics",
    "retail",
    "foodService",
    "media",
    "telecommunications",
    "finance",
    "aerospace",
  ];

  const sectorData = sectorTypes.map((type) => {
    const ownedRevenue = ownedByType.get(type) ?? 0;
    const unownedRevenue = unownedMap.get(type) ?? 0;
    const totalMarket = ownedRevenue + unownedRevenue;
    const unownedPercent = totalMarket > 0 ? (unownedRevenue / totalMarket) * 100 : 0;
    const splitCost = Math.round(unownedRevenue * 0.05);
    const estimatedCapture = Math.round(unownedRevenue * 0.05 * 1.25);
    const estimatedCapturePercent =
      unownedRevenue > 0 ? (estimatedCapture / unownedRevenue) * 100 : 0;

    return {
      type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
      totalMarket,
      ownedRevenue,
      unownedRevenue,
      unownedPercent,
      splitCost,
      estimatedCapture,
      estimatedCapturePercent,
    };
  });

  return {
    stateId,
    stateName: state.name,
    countryId: state.countryId as CountryId,
    sectors: sectorData,
  };
}

/**
 * Fetch market positions for all corporations owned by the character.
 * Optimized to avoid N+1 queries by using Maps for lookups.
 */
async function fetchMarketPositions(
  db: Awaited<ReturnType<typeof getDb>>,
  character: Character
): Promise<CorpMarketPosition[]> {
  const corporations = await db
    .collection<Corporation>("corporations")
    .find({ ceoId: new ObjectId(character._id) })
    .project<{ _id: ObjectId; type: string; name: string } & CorpCapitalCurrencyInfo>({
      _id: 1,
      type: 1,
      name: 1,
      countryId: 1,
      liquidCurrencyCode: 1,
    })
    .toArray();

  if (corporations.length === 0) return [];

  const corpIds = corporations.map((c) => c._id);
  const corpMap = new Map(corporations.map((c) => [c._id.toString(), c]));

  const sectors = await db
    .collection<{
      _id: ObjectId;
      corporationId: ObjectId;
      stateId: string;
      sectorType: string;
      revenue: number;
    }>("corporateSectors")
    .find({ corporationId: { $in: corpIds } })
    .toArray();

  if (sectors.length === 0) return [];

  // Collect unique state+sectorType combinations from user's sectors
  const stateSectorKeys = new Set<string>();
  for (const sector of sectors) {
    stateSectorKeys.add(`${sector.stateId}:${sector.sectorType}`);
  }

  // Find sibling corps competing in these state+sectorType slots so market-share
  // math normalizes every revenue figure — not just the character's own corps.
  const siblingSectors = await db
    .collection<{ corporationId: ObjectId; stateId: string; sectorType: string; revenue: number }>(
      "corporateSectors"
    )
    .find({
      $or: Array.from(stateSectorKeys).map((key) => {
        const [stateId, sectorType] = key.split(":");
        return { stateId, sectorType };
      }),
    })
    .toArray();

  const siblingCorpIds = Array.from(
    new Set(siblingSectors.map((s) => s.corporationId.toString()))
  ).filter((id) => ObjectId.isValid(id));
  const [siblingCorpsForFx, fxByCurrency] = await Promise.all([
    siblingCorpIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: siblingCorpIds.map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId } & CorpCapitalCurrencyInfo>({
            _id: 1,
            countryId: 1,
            liquidCurrencyCode: 1,
          })
          .toArray()
      : Promise.resolve([]),
    loadFxRatesByCurrency(db),
  ]);
  // Market-share denominator spans every corp that holds a slot in this state
  // sector; each corp carries its own liquidCurrencyCode (v0.2.6), so cross-corp
  // totals must sum in ₳ to make the ratio meaningful.
  const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
  for (const c of siblingCorpsForFx) {
    fxByCorpId.set(c._id.toString(), {
      code: resolveCorpLiquidCurrencyCode(c),
      rate: fxRateForCorpFromMap(c, fxByCurrency),
    });
  }
  for (const c of corporations) {
    if (!fxByCorpId.has(c._id.toString())) {
      fxByCorpId.set(c._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(c),
        rate: fxRateForCorpFromMap(c, fxByCurrency),
      });
    }
  }

  // Fetch only the unowned sectors that match the user's state+sectorType combinations
  const unownedSectors = await db
    .collection<{ stateId: string; sectorType: string; revenue: number }>("unownedSectors")
    .find({
      $or: Array.from(stateSectorKeys).map((key) => {
        const [stateId, sectorType] = key.split(":");
        return { stateId, sectorType };
      }),
    })
    .toArray();

  // Build state-level sector totals in ₳ using Maps for O(1) lookup
  const stateSectorTotals = new Map<string, Map<string, number>>();
  for (const sector of siblingSectors) {
    const fx = fxByCorpId.get(sector.corporationId.toString());
    const revenueAnchor = readCorpEconomicAnchor(sector.revenue, fx?.code, fx?.rate ?? 1);
    const stateMap = stateSectorTotals.get(sector.stateId) ?? new Map();
    const current = stateMap.get(sector.sectorType) ?? 0;
    stateMap.set(sector.sectorType, current + revenueAnchor);
    stateSectorTotals.set(sector.stateId, stateMap);
  }

  for (const unowned of unownedSectors) {
    const stateMap = stateSectorTotals.get(unowned.stateId) ?? new Map();
    const current = stateMap.get(unowned.sectorType) ?? 0;
    stateMap.set(unowned.sectorType, current + unowned.revenue);
    stateSectorTotals.set(unowned.stateId, stateMap);
  }

  // Pre-compute corp counts per state+sectorType for average market share
  const corpCounts = new Map<string, number>();
  const seenCorpInSector = new Map<string, Set<string>>();
  for (const sector of siblingSectors) {
    const key = `${sector.stateId}:${sector.sectorType}`;
    const corpId = sector.corporationId.toString();
    if (!seenCorpInSector.has(key)) {
      seenCorpInSector.set(key, new Set());
    }
    if (!seenCorpInSector.get(key)!.has(corpId)) {
      seenCorpInSector.get(key)!.add(corpId);
      corpCounts.set(key, (corpCounts.get(key) ?? 0) + 1);
    }
  }

  const positions: CorpMarketPosition[] = [];
  for (const sector of sectors) {
    const stateTotalMap = stateSectorTotals.get(sector.stateId);
    const sectorTotalAnchor = stateTotalMap?.get(sector.sectorType) ?? 0;
    const fx = fxByCorpId.get(sector.corporationId.toString());
    const sectorRevenueAnchor = readCorpEconomicAnchor(sector.revenue, fx?.code, fx?.rate ?? 1);
    const marketShare = sectorTotalAnchor > 0 ? (sectorRevenueAnchor / sectorTotalAnchor) * 100 : 0;

    const key = `${sector.stateId}:${sector.sectorType}`;
    const corpCount = corpCounts.get(key) ?? 1;
    const avgMarketShare = 100 / corpCount;

    const corp = corpMap.get(sector.corporationId.toString());
    if (corp) {
      positions.push({
        corporationId: sector.corporationId.toString(),
        corporationName: corp.name,
        sectorId: sector._id.toString(),
        revenue: sector.revenue,
        marketSharePercent: Math.round(marketShare * 10) / 10,
        sectorType: sector.sectorType,
        stateId: sector.stateId,
        avgMarketShare: Math.round(avgMarketShare * 10) / 10,
      });
    }
  }

  return positions;
}

/**
 * GET /api/actions/recommendations
 *
 * Returns personalized action recommendations based on:
 * - Character stats (actions, funds, influence, favorability, etc.)
 * - Home state economy (unowned sector opportunities)
 * - National economy (large unowned sectors in other states)
 * - Corporation market positions (competitive gaps)
 * - Party treasury and org status
 */
export async function GET() {
  try {
    const auth = await requireBasicAuth();
    if (!auth.ok) return auth.response;
    const authUser = auth.user;

    const db = await getDb();
    const [gameState, character, forexEnabled] = await Promise.all([
      getGameState(),
      getCharacterByUserId(db, authUser.userId),
      isForexEnabled(),
    ]);

    if (!character) {
      return NextResponse.json({ recommendations: [], currentTurn: gameState?.currentTurn ?? 1 });
    }

    // Check new-player onboarding state in parallel with main data fetch.
    // hasVoted uses the shared bill-vote derivation (bills/stateBills embedded
    // vote maps) — the old voteTallies.characterId query matched nothing, so
    // the "vote on a bill" suggestion never auto-completed.
    const [hasVoted, hasActiveCandidacy] = await Promise.all([
      hasVotedOnAnyBill(db, character._id),
      db
        .collection<ElectionCandidate>("electionCandidates")
        .countDocuments({ characterId: character._id }, { limit: 1 })
        .then((n) => n > 0),
    ]);

    // Fetch all required data in parallel
    const [homeState, _allStates, party, statePartyOrg] = await Promise.all([
      db
        .collection<State>("states")
        .findOne({ _id: character.homeState, countryId: character.countryId }),
      db.collection<State>("states").find({}).toArray(),
      character.party
        ? db.collection<PoliticalParty>("politicalParties").findOne({
            sequentialId: Number(character.party),
            countryId: character.countryId,
          })
        : null,
      character.party
        ? db.collection<StatePartyOrg>("statePartyOrg").findOne({
            countryId: character.countryId,
            stateId: character.homeState,
            partyId: character.party,
          })
        : null,
    ]);

    // Fetch economy data for home state only (for split recommendations)
    // Don't fetch all 50+ state economies - that's an N+1 anti-pattern
    const homeStateEconomy = homeState
      ? await fetchStateEconomy(
          db as Awaited<ReturnType<typeof getDb>>,
          character.homeState,
          homeState.name,
          homeState.countryId as CountryId
        )
      : undefined;

    // For national economy recommendations, fetch aggregated data in a single query
    // instead of fetching each state's economy individually
    const allStateEconomies = homeStateEconomy ? [homeStateEconomy] : [];

    // Fetch market positions
    const marketPositions = await fetchMarketPositions(
      db as Awaited<ReturnType<typeof getDb>>,
      character
    );

    // Fetch party budget if member
    let partyBudget: PartyBudget | null = null;
    if (party) {
      partyBudget = await findPartyBudgetForScope(db.collection<PartyBudget>("partyBudget"), {
        partyId: String(party.sequentialId),
        countryId: party.countryId,
        scope: "national",
      });
    }

    // Fetch user's corporations (for sector types + image checks)
    const userCorpSectorTypes: string[] = [];
    const corporations = await db
      .collection<{
        _id: ObjectId;
        type: string;
        secondaryType?: string | null;
        name: string;
        logoUrl?: string;
        headerImageUrl?: string;
      }>("corporations")
      .find({ ceoId: new ObjectId(character._id) })
      .toArray();
    for (const corp of corporations) {
      if (corp.type && !userCorpSectorTypes.includes(corp.type)) {
        userCorpSectorTypes.push(corp.type);
      }
      if (corp.secondaryType && !userCorpSectorTypes.includes(corp.secondaryType)) {
        userCorpSectorTypes.push(corp.secondaryType);
      }
    }

    // Fetch vacant party positions (state and national level) - filter by user's home state
    const vacantPositions: Array<{
      type: string;
      stateId?: string;
      partyId: string;
      level: "state" | "national";
    }> = [];
    if (character.party) {
      // Check state-level vacancies - only in user's home state
      const stateOrgs = await db
        .collection<StatePartyOrg>("statePartyOrg")
        .find({
          partyId: character.party,
          stateId: character.homeState,
        })
        .toArray();
      for (const org of stateOrgs) {
        if (!org.chairId) {
          vacantPositions.push({
            type: "chair",
            stateId: org.stateId,
            partyId: character.party,
            level: "state",
          });
        }
        if (!org.viceChairId) {
          vacantPositions.push({
            type: "vice chair",
            stateId: org.stateId,
            partyId: character.party,
            level: "state",
          });
        }
        if (!org.treasurerId) {
          vacantPositions.push({
            type: "treasurer",
            stateId: org.stateId,
            partyId: character.party,
            level: "state",
          });
        }
      }
      // Check national-level vacancies
      const nationalLeadership = await db
        .collection<{
          partyId: string;
          chairId?: ObjectId | null;
          viceChairId?: ObjectId | null;
          treasurerId?: ObjectId | null;
        }>("nationalPartyLeadership")
        .findOne({ partyId: character.party });
      if (nationalLeadership) {
        if (!nationalLeadership.chairId) {
          vacantPositions.push({
            type: "national chair",
            partyId: character.party,
            level: "national",
          });
        }
        if (!nationalLeadership.viceChairId) {
          vacantPositions.push({
            type: "national vice chair",
            partyId: character.party,
            level: "national",
          });
        }
        if (!nationalLeadership.treasurerId) {
          vacantPositions.push({
            type: "national treasurer",
            partyId: character.party,
            level: "national",
          });
        }
      }
    }

    // Generate recommendations
    const recommendations = generateRecommendations({
      character,
      homeStateEconomy,
      allStateEconomies,
      party: party ?? undefined,
      partyBudget: partyBudget ?? undefined,
      statePartyOrg: statePartyOrg ?? undefined,
      marketPositions,
      currentTurn: gameState?.currentTurn ?? 1,
      userCorpSectorTypes,
      corporations: corporations.map((c) => ({
        _id: c._id.toString(),
        name: c.name,
        logoUrl: c.logoUrl,
        headerImageUrl: c.headerImageUrl,
      })),
      vacantPositions,
      partyName: party?.name,
      hasVoted,
      hasActiveCandidacy,
      forexEnabled,
      // Splitting is retired under plants, so its recommendations are dropped.
      plantsEnabled: marketAtLeast(await getMarketSystemModeForDb(db), "plants"),
    });

    return NextResponse.json({
      recommendations,
      currentTurn: gameState?.currentTurn ?? 1,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
