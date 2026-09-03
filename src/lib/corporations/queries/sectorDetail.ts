import { NextResponse } from "next/server";
import { findMergedRegionMetrics } from "@/lib/macroMetrics/merge";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getAuthUser } from "@/lib/auth";
import { handleRouteError } from "@/lib/api/errors";
import { resolveCorporation } from "@/lib/api/corporations/resolveQuery";
import { buildPoliticalBaseModifiers } from "@/lib/politicalLegislation/marginAdapter";
import { isPoliticalApprovalCountry } from "@/lib/politicalLegislation/politicalApprovalProvider";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { isLabourWagesEnabled, isLabourFullMode } from "@/lib/labour/featureFlag";
import { isProspectingEnabled } from "@/lib/extraction/featureFlag";
import {
  sectorWageLevel,
  MEDIAN_SECTOR_WAGE_LEVEL,
  minWageFloorMultiplier,
} from "@/lib/labour/laborCost";
import type {
  Corporation,
  CorporateSector,
  FederalBudget,
  StateBudget,
  State,
  Character,
  Tariff,
  UnownedSector,
  Subsidy,
  Union,
} from "@/lib/db/types";
import {
  getTariffBlendWeights,
  buildSectorPresenceKeys,
  tariffRulesNeedSectorPresenceKeys,
} from "@/lib/tariffs/tariffEffects";
import { buildFtaCoverageLookup, loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { CORPORATION_TYPE_LABELS, calculateWorkers } from "@/lib/constants/corporations";
import type {
  CorporationType,
  StateMetricValues,
  MacroEconomicValues,
} from "@/lib/constants/corporations";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { type CommodityType } from "@/lib/constants/commodities";
import { sectorDemandGapUnits } from "@/lib/market/sectorDemandGap";
import { commodityDemandGap } from "@/lib/market/commodityMarketScope";
import { bookFor, loadReachableBooks } from "@/lib/trade/queries/loadReachableBooks";
import type { CountryId } from "@/lib/constants/countries";
import type { CommodityPrice, GameConfig, GameState } from "@/lib/db/types";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { STARTING_YEAR, TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import {
  getCorpFxRate,
  getSectorHostFxRate,
  loadFxRatesByCurrency,
  resolveSectorHostCurrencyCode,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getNationalCommodityBalance } from "@/lib/commodity-map";
import { buildDepositCapacityRows } from "@/lib/corporations/strategyRevenuePreview";
import { shouldRedactCorporation, redactPrivateCorporation } from "@/lib/corporations/redaction";
import { computeSectorExtractionCapacityContext } from "@/lib/corporations/queries/sectorDetailExtraction";
import {
  computeResourceOpportunities,
  type ResourceOpportunity,
} from "@/lib/corporations/queries/extractionOpportunities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { buildSectorCommoditySections } from "@/lib/corporations/queries/sectorDetailCommodities";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import { buildPolicyStackRows } from "@/lib/corporations/plantsPnlBasis";
import {
  buildSectorAttackInfo,
  buildSectorCrisisSection,
  buildSectorForSaleInfo,
  buildSectorStrategySection,
  computeSectorMarginSection,
  computeSectorMarketPosition,
  computeSectorTaxSection,
  computeTechGrowthCostReductionPct,
  buildSectorPlantsSection,
} from "@/lib/corporations/queries/sectorDetailSections";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import { buildMarketContext } from "@/lib/market/marketContext";
import { resolveCountryPrimeRate } from "@/lib/corporations/sectorGrowthCost";
import { unownedHeadroomUnitsOf } from "@/lib/corporations/marketShare";
import { getSectorTechEffects } from "@/lib/constants/techTree";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import { corpLiquidCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { corpToSectorCountrySpread } from "@/lib/currency/sectorFxSpread";

interface RouteParams {
  params: Promise<{ id: string; sectorId: string }>;
}

/**
 * The slice of a rival corporation the market-position panel needs: enough to
 * name and colour it, plus the two fields that decide whether it is player-owned
 * or part of the NPP field.
 */
type SiblingCorpProjection = Pick<
  Corporation,
  | "_id"
  | "name"
  | "sequentialId"
  | "brandColor"
  | "countryId"
  | "liquidCurrencyCode"
  | "ceoType"
  | "caretakerCeo"
>;

/**
 * GET /api/corporations/[id]/sectors/[sectorId]
 * Full sector detail with margin modifier breakdown and market context.
 */
export async function getCorporationSectorDetail(request: Request, { params }: RouteParams) {
  try {
    const { id, sectorId } = await params;
    const db = await getDb();

    // Resolve corporation
    const resolved = await resolveCorporation(db, id);
    if (!resolved.ok) return resolved.response;
    const { corporation } = resolved;

    // Resolve sector
    if (!ObjectId.isValid(sectorId)) {
      return NextResponse.json({ error: "Invalid sector ID" }, { status: 400 });
    }

    const sector = await db
      .collection<CorporateSector>("corporateSectors")
      .findOne({ _id: new ObjectId(sectorId), corporationId: corporation._id });

    if (!sector) {
      return NextResponse.json({ error: "Sector not found" }, { status: 404 });
    }

    // Check if requesting user is CEO
    const user = await getAuthUser().catch(() => null);
    const isCeo = !!(user && corporation.userId?.toString() === user.userId);
    const viewerIsAdmin = user?.isAdmin === true;
    const modViewEnabled =
      !viewerIsAdmin &&
      user?.isModerator === true &&
      new URL(request.url).searchParams.get("modView") === "1";
    const shouldRedact = shouldRedactCorporation(
      corporation,
      user?.userId ?? undefined,
      viewerIsAdmin,
      modViewEnabled
    );
    // Financial fog of war (public corps only, non-insiders), mirrors the
    // protection GET /api/corporations/[id] already applies, so a competitor
    // can't see a public corp's live sector financials through this page when
    // the corp page itself would show them a fogged/delayed estimate instead.
    // Unlike the corp page, there is no per-sector historical snapshot to
    // build a jittered quarterly estimate from, so this takes the stricter
    // path of hiding the figures outright rather than approximating them.
    // Does not check for CEO-of-controlling-parent (the corp page's other
    // insider case), a parent-corp CEO sees this sector fogged too, which is
    // overly cautious but not a leak.
    const isPublicCorp = !corporation.isPrivate && !corporation.countryOwnerId;
    const isInsider = isCeo || viewerIsAdmin;
    const publicFinancialFog = isPublicCorp && !shouldRedact && !isInsider;

    // Look up the viewer's corporation (for attack/split UI)
    let viewerCorporation: Corporation | null = null;
    if (isCeo) {
      viewerCorporation = corporation;
    } else if (user) {
      const viewerChar = await db
        .collection<Character>("characters")
        .findOne({ userId: new ObjectId(user.userId) });
      if (viewerChar) {
        viewerCorporation = await db.collection<Corporation>("corporations").findOne(
          { ceoId: viewerChar._id, ceoVacant: { $ne: true } },
          {
            projection: {
              _id: 1,
              marketingStrength: 1,
              liquidCapital: 1,
              splitEscalation: 1,
              headquartersState: 1,
              countryId: 1,
              liquidCurrencyCode: 1,
            },
          }
        );
      }
    }
    // Resolve viewer's home-currency FX rate so we can convert liquidCapital → ₳
    // before sending to the client (splitCost / attackCost are in ₳; mixing units
    // makes the Split panel warn "Need $X capital" against a raw local-currency
    // balance that the client's formatAmount helper then interprets as ₳).
    const [viewerCorpFxRate, sectorHostFxRate, corporationFxRate] = await Promise.all([
      viewerCorporation ? getCorpFxRate(db, viewerCorporation) : Promise.resolve(1.0),
      getSectorHostFxRate(db, sector, corporation),
      getCorpFxRate(db, corporation),
    ]);
    // The sector's economic fields are stored in its HOST-state currency (the
    // market it operates in), not the owning corp's, resolve that code/rate to
    // normalize sector.revenue to ₳ for the retool/cancel/attack cost previews.
    const sectorHostLiquidCode = resolveSectorHostCurrencyCode(sector, corporation);
    const corporationLiquidCode = resolveCorpLiquidCurrencyCode(corporation);
    const sectorAmountAnchor = (amount: number) =>
      readCorpEconomicAnchor(amount, sectorHostLiquidCode, sectorHostFxRate);
    const sectorAmountInCorpCurrency = (amount: number) =>
      writeCorpEconomicLocal(sectorAmountAnchor(amount), corporationLiquidCode, corporationFxRate);

    // Fetch state, all state ids, state metrics, CEO, commodity prices, corp siblings, and game state in parallel
    // SP4 §4a: the region's political board rides along for the margin overlay.
    const politicalDocPromise = isPoliticalApprovalCountry(sector.countryId)
      ? db
          .collection<PoliticalMetricsDoc>("politicalMetrics")
          .findOne({ _id: sector.stateId, countryId: sector.countryId })
      : Promise.resolve(null);
    const [state, allStates, stateMetrics, ceo, commodityPrices, allCorpSectors, gameState] =
      await Promise.all([
        db
          .collection<State>("states")
          .findOne({ _id: sector.stateId, countryId: sector.countryId }),
        db
          .collection<State>("states")
          .find({}, { projection: { _id: 1, countryId: 1 } })
          .toArray(),
        findMergedRegionMetrics(db, { _id: sector.stateId, countryId: sector.countryId }),
        corporation.ceoType === "imperial"
          ? db
              .collection("imperialCharacters")
              .findOne(
                { _id: corporation.ceoId },
                { projection: { name: 1, sequentialId: 1, avatarUrl: 1 } }
              )
          : corporation.ceoType === "npp"
            ? db
                .collection("npps")
                .findOne(
                  { _id: corporation.ceoId },
                  { projection: { name: 1, sequentialId: 1, avatarUrl: 1 } }
                )
            : db.collection<Character>("characters").findOne(
                { _id: corporation.ceoId },
                {
                  projection: {
                    name: 1,
                    sequentialId: 1,
                    avatarUrl: 1,
                    // Plants tier: the build-cost quote is acumen-sensitive, and
                    // this is the CEO document the quote is about. Projected here
                    // rather than re-read so the plants block costs no extra query.
                    "stats.businessAcumen": 1,
                  },
                }
              ),
        db.collection<CommodityPrice>("commodityPrices").find({}).toArray(),
        db
          .collection<CorporateSector>("corporateSectors")
          .find(
            { corporationId: corporation._id },
            {
              projection: {
                _id: 1,
                stateId: 1,
                countryId: 1,
                revenue: 1,
                realizedRevenue: 1,
                profitMargin: 1,
                currentGrowthCost: 1,
              },
            }
          )
          .toArray(),
        db.collection<GameState>("gameState").findOne({ _id: "current" }),
      ]);
    const totalCorpSectors = allCorpSectors.length;
    // SP4 §4a: political margin overlay for playable regions (null elsewhere).
    const politicalDoc = await politicalDocPromise;
    const politicalBaseModifiers = politicalDoc
      ? buildPoliticalBaseModifiers(politicalDoc.values)
      : null;

    // Fetch federal budget for macroeconomic margin modifiers
    // Fallback to state or corporation countryId for pre-migration sectors
    const sectorCountryId = sector.countryId ?? state?.countryId ?? corporation.countryId;
    // Fetch all countries' federal budgets and all sibling states' state budgets so we can
    // apportion tax across every sector (not just this one), matches corp page math.
    // (stateCountryMap is redeclared later for commodity balance math; use inline lookup here.)
    const stateCountryLookup = new Map(allStates.map((s) => [s._id, s.countryId]));
    const siblingCountryIds = new Set<string>();
    const siblingStateIds = new Set<string>();
    for (const s of allCorpSectors) {
      siblingCountryIds.add(
        s.countryId ?? stateCountryLookup.get(s.stateId) ?? corporation.countryId
      );
      siblingStateIds.add(s.stateId);
    }
    const [federalBudget, allFederalBudgets, allSiblingStateBudgets, coveringIndustryUnionDoc] =
      await Promise.all([
        db.collection<FederalBudget>("federalBudget").findOne(
          { countryId: sectorCountryId },
          {
            projection: {
              "economicFactors.inflationRate": 1,
              debtToGdpRatio: 1,
              surplus: 1,
              gdp: 1,
              "taxRates.domesticCorporateTax": 1,
              "taxRates.foreignCorporateTax": 1,
            },
          }
        ),
        db
          .collection<FederalBudget>("federalBudget")
          .find(
            { countryId: { $in: [...siblingCountryIds] } },
            {
              projection: {
                countryId: 1,
                "taxRates.domesticCorporateTax": 1,
                "taxRates.foreignCorporateTax": 1,
              },
            }
          )
          .toArray(),
        db
          .collection<StateBudget>("stateBudgets")
          .find(
            { _id: { $in: [...siblingStateIds] } },
            {
              projection: {
                _id: 1,
                "taxRates.domesticCorporateTax": 1,
                "taxRates.foreignCorporateTax": 1,
              },
            }
          )
          .toArray(),
        // One union covers every local in a country's industry. Return its
        // identity even while the presidency is vacant so a sector's workforce
        // can always link to the institution organizing it. Wage demands still
        // only count once that union has a leader, preserving the existing
        // player-run-union rule.
        //
        // Union dues v1 note: since players can found rivals, this find-one no
        // longer identifies THE union of the industry, only one of them. It is
        // kept for the existing wage-demand display, which predates rivals.
        // Which union actually represents THIS sector is a separate lookup
        // below, keyed on the sector's own `representingUnionId`.
        db
          .collection<Union>("unions")
          .findOne(
            { countryId: sectorCountryId, sectorType: sector.sectorType },
            { projection: { name: 1, ownerId: 1, demandedWageLevel: 1 } }
          ),
      ]);

    // Union dues v1: the union that actually holds this sector, which may be a
    // founded rival rather than the seeded industry union above, or nobody at
    // all. The sector page needs it to say whether organizing here is a first
    // claim or a raid.
    const representingUnionDoc = sector.representingUnionId
      ? await db
          .collection<Union>("unions")
          .findOne({ _id: sector.representingUnionId }, { projection: { name: 1 } })
      : null;
    const macroEcon: MacroEconomicValues = {
      inflationRate: federalBudget?.economicFactors?.inflationRate ?? null,
      debtToGdpRatio: federalBudget?.debtToGdpRatio ?? null,
      surplusToGdpRatio: federalBudget?.gdp
        ? (federalBudget.surplus ?? 0) / federalBudget.gdp
        : null,
    };

    // Load tariff policy and market context together; these reads are independent.
    const [allTariffs, activeSubsidies, activeFtaPairs, allSectorsRaw, siblingsSectors] =
      await Promise.all([
        db.collection<Tariff>("tariffs").find({}).toArray(),
        db.collection<Subsidy>("subsidies").find({ active: true }).toArray(),
        loadActiveFtaPairs(db),
        db
          .collection<CorporateSector>("corporateSectors")
          .find({}, { projection: { corporationId: 1, countryId: 1, sectorType: 1, revenue: 1 } })
          .toArray(),
        db
          .collection<CorporateSector>("corporateSectors")
          .find({ stateId: sector.stateId, sectorType: sector.sectorType })
          .toArray(),
      ]);

    // FTA coverage shares are unconditionally needed by getDomesticTariffMalus
    // and getTariffBlendWeights to scale broad-tariff friction by partner
    // exposure. blendPresenceKeys is additionally needed only when origin/corp
    // tariffs exist. Both are computed from the same sectors+corps slice.
    const corpIds = [...new Set(allSectorsRaw.map((s) => s.corporationId.toString()))];
    const siblingCorpIds = [...new Set(siblingsSectors.map((s) => s.corporationId.toString()))].map(
      (id) => new ObjectId(id)
    );
    const [corpsForLookup, siblingCorps, siblingFxByCurrency, unownedDoc] = await Promise.all([
      corpIds.length > 0
        ? db
            .collection<Corporation>("corporations")
            .find(
              { _id: { $in: corpIds.map((cid) => new ObjectId(cid)) } },
              { projection: { _id: 1, countryId: 1 } }
            )
            .toArray()
        : Promise.resolve([] as Corporation[]),
      siblingCorpIds.length > 0
        ? db
            .collection<Corporation>("corporations")
            .find({ _id: { $in: siblingCorpIds } })
            .project<SiblingCorpProjection>({
              _id: 1,
              name: 1,
              sequentialId: 1,
              brandColor: 1,
              countryId: 1,
              liquidCurrencyCode: 1,
              // Who actually OWNS the corp, for the market panel's player/NPP
              // split. `caretakerCeo` rides along because an NPP caretaker runs
              // a corp whose owner is still a player, and that corp belongs with
              // the player corps.
              ceoType: 1,
              caretakerCeo: 1,
            })
            .toArray()
        : Promise.resolve([] as SiblingCorpProjection[]),
      loadFxRatesByCurrency(db),
      db.collection<UnownedSector>("unownedSectors").findOne({
        stateId: sector.stateId,
        sectorType: sector.sectorType,
      }),
    ]);
    const corpByIdForLookup = new Map(corpsForLookup.map((c) => [c._id.toString(), c]));

    const blendPresenceKeys = tariffRulesNeedSectorPresenceKeys(allTariffs)
      ? buildSectorPresenceKeys(allSectorsRaw, corpByIdForLookup)
      : new Set<string>();

    const ftaCoverage = buildFtaCoverageLookup(allSectorsRaw, corpByIdForLookup, activeFtaPairs);

    // Extract raw state metric values for display context and modifier computation
    const sectorType = sector.sectorType as CorporationType;
    const metrics: StateMetricValues = {
      fullMetrics: stateMetrics ?? null,
      unemploymentRate: stateMetrics?.economic?.unemploymentRate?.value ?? null,
      gridReliability: stateMetrics?.infrastructure?.powerGridReliability?.value ?? null,
      corruptionIndex: stateMetrics?.governance?.corruptionIndex?.value ?? null,
      workforceSkill: stateMetrics?.education?.workforceSkill?.value ?? null,
      crimeRate: stateMetrics?.publicSafety?.crimeRate?.value ?? null,
      broadbandAccess: stateMetrics?.infrastructure?.broadbandAccess?.value ?? null,
      roadCondition: stateMetrics?.infrastructure?.roadCondition?.value ?? null,
      carbonEmissions: stateMetrics?.environment?.carbonEmissions?.value ?? null,
      costOfLiving: stateMetrics?.economic?.costOfLiving?.value ?? null,
    };
    // Note: margin modifiers will be computed after commodity data is available

    // Market position: totals, market share, competitors, unowned pool ,
    // see computeSectorMarketPosition.
    const sectorDetailPreset = resolvePresetIdFromGameState(gameState);
    const sectorDetailUnitScale = getEraUnitScale(sectorDetailPreset);
    const {
      effectiveMarket,
      marketShare,
      competitors,
      unownedRevenue,
      unownedPercent,
      siblingRevenueAnchorById,
    } = computeSectorMarketPosition({
      state,
      sector,
      sectorCountryId,
      corporation,
      siblingCorps,
      siblingsSectors,
      siblingFxByCurrency,
      unownedDoc,
      preset: sectorDetailPreset,
    });

    const stateCountryMap = new Map<string, string>(
      allStates.map((s) => [String(s._id), s.countryId])
    );

    // Build global, national, and state balance maps for tariff-aware blending.
    // National totals prefer cp.nationalSupply/nationalDemand so federal demand
    // injected after the state→country rollup (e.g. govt healthcare) is included.
    const globalBalances = new Map<CommodityType, { supply: number; demand: number }>();
    const nationalBalancesByCountry = new Map<
      string,
      Map<CommodityType, { supply: number; demand: number }>
    >();
    const stateBalances = new Map<CommodityType, { supply: number; demand: number }>();
    for (const cp of commodityPrices) {
      globalBalances.set(cp.commodity, {
        supply: cp.globalSupply,
        demand: cp.globalDemand,
      });
      const stateSupply = cp.stateSupply[sector.stateId] ?? 0;
      const stateDemand = cp.stateDemand[sector.stateId] ?? 0;
      stateBalances.set(cp.commodity, {
        supply: stateSupply,
        demand: stateDemand,
      });

      if (!nationalBalancesByCountry.has(sectorCountryId)) {
        nationalBalancesByCountry.set(sectorCountryId, new Map());
      }
      const countryBalances = nationalBalancesByCountry.get(sectorCountryId)!;
      countryBalances.set(
        cp.commodity,
        getNationalCommodityBalance(cp, sectorCountryId, stateCountryMap)
      );
    }

    // Operating strategy: resolve effective supply/demand rates
    const currentTurn = gameState?.currentTurn ?? 0;
    // Tech-tree production-method gating for the strategy picker (inert when off).
    const techTreesEnabled = gameState?.sectorTechTreesEnabled === true;
    const techCurrentYear =
      gameState?.currentYear ??
      STARTING_YEAR + Math.floor((Math.max(1, currentTurn) - 1) / TURNS_PER_YEAR);
    const techCorpView = {
      type: corporation.type,
      unlockedTechNodeIds: corporation.unlockedTechNodeIds,
      techDecadeLane: corporation.techDecadeLane,
    };
    const effectiveRates = getEffectiveStrategyRates(
      sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      currentTurn
    );

    // Extraction-only: resource capacity and per-resource multipliers ,
    // see computeSectorExtractionCapacityContext (no-op for other sectors).
    const {
      stateResources,
      thisSectorMultipliers,
      strategyCapacityMultipliers,
      extractionDesiredByResource,
    } = await computeSectorExtractionCapacityContext(db, sector, sectorType);

    // Signpost (Track 2): when this extraction sector is capacity-bound on one
    // or more resources, point the player at other states where those resources
    // still have room to grow. Binding = this sector's own multiplier is
    // clamped below ~1, unioned with the persisted binding resource. Read-only
    // guidance; no economy change.
    let extractionOpportunities: ResourceOpportunity[] | null = null;
    if (sectorType === "extraction") {
      const bindingResources = new Set<ExtractableResource>();
      for (const [resource, mult] of Object.entries(thisSectorMultipliers)) {
        if (typeof mult === "number" && mult < 0.999) {
          bindingResources.add(resource as ExtractableResource);
        }
      }
      if (sector.capacityBindingResource) {
        bindingResources.add(sector.capacityBindingResource as ExtractableResource);
      }
      if (bindingResources.size > 0) {
        const opportunities = await computeResourceOpportunities(
          db,
          [...bindingResources],
          sector.stateId
        );
        extractionOpportunities = opportunities.length > 0 ? opportunities : null;
      }
    }

    const tariffBlend = getTariffBlendWeights(
      allTariffs,
      sectorCountryId as CountryId,
      sectorType,
      blendPresenceKeys,
      ftaCoverage
    );
    const blendPct = {
      global: Math.round(tariffBlend.globalWeight * 10000) / 100,
      national: Math.round(tariffBlend.nationalWeight * 10000) / 100,
      local: Math.round(tariffBlend.localWeight * 10000) / 100,
    };

    // Commodity rows + market-system sections (supplies/demands, realization,
    // pricing, capital, throughput), see buildSectorCommoditySections.
    const sectorRevenueAnchor = sectorAmountAnchor(sector.revenue);
    const sectorLaborCostAnchor =
      typeof sector.laborCost === "number" ? sectorAmountAnchor(sector.laborCost) : null;

    const {
      effectiveSupply,
      supplies,
      demandsWithShortage,
      priceRealization,
      pricing,
      capital,
      throughput,
    } = await buildSectorCommoditySections({
      sector,
      // Commodity flows run in ₳; normalize the sector's host-currency revenue
      // to ₳ at its host rate before passing in.
      sectorRevenueAnchor,
      sectorLaborCostAnchor,
      sectorType,
      sectorCountryId,
      eraUnitScale: sectorDetailUnitScale,
      corporation,
      isCeo,
      commodityPrices,
      globalBalances,
      nationalBalancesByCountry,
      stateBalances,
      tariffBlend,
      effectiveRates,
      stateResources,
      thisSectorMultipliers,
    });

    // Dynamic crisis effects must feed the same effective margin used for
    // maintenance and profit, not only the explanatory UI.
    const { crisisMarginPenalty, activeCrises } = await buildSectorCrisisSection(
      db,
      sector,
      sectorCountryId,
      currentTurn
    );

    // Margin modifier stack (commodity blend, tariffs, subsidies, transition,
    // state metrics, regional conditions), see computeSectorMarginSection.
    const { mods, maintenance, profit, enginePnl, transitionProgress, strategyTransitionMod } =
      computeSectorMarginSection({
        sector,
        sectorType,
        sectorCountryId,
        corporation,
        state,
        stateMetrics,
        politicalBaseModifiers,
        gameState,
        metrics,
        macroEcon,
        currentTurn,
        totalCorpSectors,
        marketShare,
        allTariffs,
        activeFtaPairs,
        ftaCoverage,
        activeSubsidies,
        tariffBlend,
        effectiveSupply,
        effectiveRates,
        globalBalances,
        nationalBalancesByCountry,
        stateBalances,
        additionalMarginModifier: crisisMarginPenalty,
      });
    // Labour system (wages on): the persisted sector.laborCost is carved OUT of
    // the gross maintenance figure above (profit-invariant, see computeSectorLaborCost).
    // Surface it as its own line item and display maintenance NET of labour, so the
    // wage cost is visible instead of silently folded into Maintenance.
    const labourWagesEnabled = await isLabourWagesEnabled();
    const sectorLaborCost =
      labourWagesEnabled && typeof sector.laborCost === "number" && sector.laborCost > 0
        ? sector.laborCost
        : 0;
    const maintenanceNet = maintenance - sectorLaborCost;

    // Apportioned per-sector tax, matches the corp page formula (see
    // computeSectorTaxSection for the full derivation).
    const {
      corpLevelCosts,
      thisRevenueShare,
      thisSectorTaxable,
      sectorFederalRate,
      sectorStateRate,
      apportionedFederalTax,
      apportionedStateTax,
    } = computeSectorTaxSection({
      allFederalBudgets,
      allSiblingStateBudgets,
      corporation,
      allCorpSectors,
      sector,
      profit,
      sectorCountryId,
      fxByCurrency: siblingFxByCurrency,
    });

    const r = (v: number | null) => (v != null ? Math.round(v * 10) / 10 : null);

    // ─── Plants tier (marketSystemMode >= "plants") ──────────────────────────
    // Under plants the sector page renders a different set of panels: capacity
    // is the thing the player owns, and revenue is derived from what it makes
    // and sells. Below plants this whole block is `null` and the page is
    // unchanged. One extra read (the host prime rate) and only when plants is on.
    const marketMode = await getMarketSystemMode();
    const plantsEnabled = marketAtLeast(marketMode, "plants");
    let plants: Awaited<ReturnType<typeof buildSectorPlantsSection>> | null = null;
    if (plantsEnabled && !shouldRedact && !publicFinancialFog) {
      // Same governor bounds the turn processor resolves (turn/corporation
      // index.ts), read from gameConfig, not gameState, so the "market support"
      // pill counts down against the ramp the engine is actually applying.
      const governorConfig = await db
        .collection<GameConfig>("gameConfig")
        .findOne(
          { _id: "default" },
          { projection: { marketGovernorCap: 1, marketGovernorRampTurns: 1 } }
        );
      const marketCtx = buildMarketContext(marketMode, {
        cap: governorConfig?.marketGovernorCap,
        rampTurns: governorConfig?.marketGovernorRampTurns,
      });
      const primeRate = await resolveCountryPrimeRate(db, sectorCountryId);
      const ceoAcumen =
        (ceo as { stats?: { businessAcumen?: number } } | null)?.stats?.businessAcumen ??
        NEUTRAL_STAT;
      const techBuildCostMultiplier = techTreesEnabled
        ? getSectorTechEffects(techCorpView, corporation.type).growthCostMultiplier
        : 1;
      // Tech margin points ride `policyCredit` under plants like every other
      // non-physical modifier, and `computeAllMarginModifiers` does not carry
      // them, so name the row here rather than letting it fall into the scale
      // factor unlabelled (ticket 1122).
      const techMarginBonusPp = techTreesEnabled
        ? getSectorTechEffects(techCorpView, corporation.type).marginBonusPp
        : 0;
      // The physical input bill: the same demand rows the Inputs panel renders,
      // priced at the BILLED unit price (base x realization factor, the price
      // computeInputsCost actually charges), so the panel and the engine's
      // booked bill cannot disagree. Raw `marketPrice` is context, not the bill.
      const inputsAnchor = demandsWithShortage.reduce(
        (sum, d) => sum + (d.units > 0 ? d.units * (d.billedUnitPrice ?? d.marketPrice) : 0),
        0
      );
      // True buyers' room for THIS sector's outputs, in sector output units.
      // `headroomUnits` (the unowned pool) measures claimable market SHARE,
      // under a clearing glut it reads tens of thousands of "room" while every
      // leg goes unsold (ticket #1027 follow-up: player read it as demand).
      //
      // Scoped to the sector's HOME COUNTRY reachable book, which is the book
      // the clearing engine actually settles this sector against (see
      // market/tradePartition). The world aggregate it used to read counted
      // embargoed and untraded supply the sector can neither buy from nor lose
      // a sale to, so a sector in a real shortage was told it was oversupplied
      // (ticket #1077). Falls back to the aggregate when no book is persisted.
      const reachableBooks = await loadReachableBooks(db);
      const demandGapUnits = sectorDemandGapUnits(effectiveSupply, (gapCommodity) => {
        return commodityDemandGap({
          commodity: gapCommodity,
          stateBalance: stateBalances.get(gapCommodity),
          reachableBook: bookFor(reachableBooks, sectorCountryId, gapCommodity),
          globalBalance: globalBalances.get(gapCommodity),
        });
      });

      plants = buildSectorPlantsSection({
        sector,
        sectorType,
        currentTurn,
        currentYear: techCurrentYear,
        governorCap: marketCtx.governorCap,
        governorRampTurns: marketCtx.governorRampTurns,
        marketSharePercent: marketShare,
        // Distinct RIVAL corps in this (state, type) cell. `siblingsSectors` is
        // already scoped to exactly that cell, so this needs no extra read,
        // but it must be distinct CORPS, not sectors, or a rival holding two
        // sectors here would read as two competitors. Same definition as
        // `fetchSectorCompetitorCount`, which the build command charges from.
        competitorCount: new Set(
          siblingsSectors
            .filter((s) => s.corporationId.toString() !== corporation._id.toString())
            .map((s) => s.corporationId.toString())
        ).size,
        primeRate,
        ceoAcumen,
        hostCostOfLivingIndex: metrics.costOfLiving,
        techGrowthCostMultiplier: techBuildCostMultiplier,
        eraUnitScale: sectorDetailUnitScale,
        corpCapitalAnchor: corpLiquidCapitalToAnchor(
          corporation.liquidCapital,
          corporation,
          corporationFxRate
        ),
        headroomUnits: unownedHeadroomUnitsOf(
          sectorType,
          unownedDoc?.headroomUnits,
          unownedDoc?.revenue ?? 0,
          sectorDetailUnitScale
        ),
        demandGapUnits,
        workers: sector.workers ?? calculateWorkers(sectorRevenueAnchor, metrics.workforceSkill),
        money: {
          realizedRevenueAnchor: sectorAmountAnchor(sectorEconomicRevenue(sector)),
          maintenanceNetAnchor: sectorAmountAnchor(maintenanceNet),
          labourAnchor: sectorAmountAnchor(sectorLaborCost),
          growthCostAnchor: sectorAmountAnchor(sector.currentGrowthCost),
          profitAnchor: sectorAmountAnchor(profit),
          inputsAnchor,
          // Ticket 1122: the turn's own lines, normalized to ₳. Present on any
          // sector that has run a plants turn since the field shipped; the
          // builder falls back to reconstruction when it is null.
          enginePnl: enginePnl
            ? {
                revenue: sectorAmountAnchor(enginePnl.revenue),
                inputs: sectorAmountAnchor(enginePnl.inputs),
                labour: sectorAmountAnchor(enginePnl.labour),
                upkeep: sectorAmountAnchor(enginePnl.upkeep),
                compliance: sectorAmountAnchor(enginePnl.compliance),
                otherOpex: sectorAmountAnchor(enginePnl.otherOpex),
                financialLegs: sectorAmountAnchor(enginePnl.financialLegs),
                inventoryCarry: sectorAmountAnchor(enginePnl.inventoryCarry ?? 0),
                policyCredit: sectorAmountAnchor(enginePnl.policyCredit),
                policyPp: enginePnl.policyPp,
                operatingCost: sectorAmountAnchor(enginePnl.operatingCost),
                totalCost: sectorAmountAnchor(enginePnl.totalCost),
                profit: sectorAmountAnchor(enginePnl.profit),
              }
            : null,
        },
        // The modifier stack behind that credit, already in money and summing
        // to it exactly, so the panel can show WHY the profit is what it is
        // rather than one opaque line. Same rows the corporation page's margin
        // drilldown lists, minus commodity pressure, which the physical model
        // prices directly as the input bill and the sale price.
        policyStack: enginePnl
          ? buildPolicyStackRows({
              policyCreditAnchor: sectorAmountAnchor(enginePnl.policyCredit),
              revenueAnchor: sectorAmountAnchor(enginePnl.revenue),
              mods: { ...mods, techMarginBonus: techMarginBonusPp },
              appliedPolicyPp: enginePnl.policyPp,
            })
          : [],
        regulatoryBurdenPp: mods.dominanceRegulatoryBurdenPp ?? 0,
        crisisMarginPenaltyPp: crisisMarginPenalty,
        // C9: the same spread `buildCapacity` charges on top of the build cost.
        // Priced off 1 ₳ so the result is the RATE, which is all the quote needs
        // (the spread is strictly proportional to the construction cost).
        fxSpreadRate: corpToSectorCountrySpread(corporation, sectorCountryId, 1).spreadAnchor,
        depositBound:
          sectorType === "extraction" &&
          Object.values(thisSectorMultipliers).some((m) => typeof m === "number" && m < 0.999),
      });
    }

    const payload: Record<string, unknown> = {
      sector: {
        _id: sector._id,
        stateId: sector.stateId,
        // Sector's country determines the home currency that Market Position
        // totals render in, a pinned viewer preference would otherwise mask
        // that "total market" is an economy-anchored quantity, not a wallet-
        // anchored one, and make it wobble with forex rate drift each turn.
        countryId: sectorCountryId,
        stateName: state?.name ?? sector.stateId,
        sectorType: sector.sectorType,
        sectorLabel: CORPORATION_TYPE_LABELS[sector.sectorType as CorporationType],
        displayName: sector.displayName ?? null,
        targetGrowthRate: sector.targetGrowthRate ?? 0,
        currentGrowthRate: sector.currentGrowthRate ?? sector.growthRate ?? 0,
        currentGrowthCost: Math.round(sectorAmountInCorpCurrency(sector.currentGrowthCost)),
        revenue: Math.round(sectorAmountInCorpCurrency(sector.revenue)),
        workers: sector.workers ?? calculateWorkers(sectorRevenueAnchor, metrics.workforceSkill),
        workersDesired:
          sector.workersDesired ?? calculateWorkers(sectorRevenueAnchor, metrics.workforceSkill),
        labourStaffingFactor: sector.labourStaffingFactor ?? 1,
        productionPolicy: sector.productionPolicy ?? 0,
        productionPolicyLevel: sector.productionPolicyLevel ?? 0,
        // Labour system: CEO wage-level lever (1.0 = baseline), the sector's pay
        // level relative to the median sector, and the minimum-wage cost uplift
        // (0 when the Kaitz floor doesn't bind this sector).
        wageLevel: sector.wageLevel ?? 1,
        payVsMedian:
          Math.round((sectorWageLevel(sector.sectorType) / MEDIAN_SECTOR_WAGE_LEVEL) * 100) / 100,
        minWageUplift:
          Math.round(
            (minWageFloorMultiplier(sector.sectorType, federalBudget?.minimumWageKaitzRatio ?? 0) -
              1) *
              1000
          ) / 1000,
        // v3 Phase 5/6 (labourSystemMode ≥ "unions"): NPC unionization
        // pressure, 0-100. Feeds unionPremium (labor cost) and the strike
        // trigger threshold.
        unionization: sector.unionization ?? 0,
        // v3 Phase 6: read-only, no dedicated UI panel this phase (backend
        // first, matching Phase 5's precedent).
        workerExpectationIndex: sector.workerExpectationIndex ?? null,
        strikeActive: sector.strikeStartedAtTurn != null,
        // v3 Phase 7a: cooldown state for the union-busting UI panel.
        bustingCooldownUntilTurn: sector.bustingCooldownUntilTurn ?? null,
        // v3 Phase 8: identity of the union covering this country's industry,
        // including a vacant union, plus any demand made by an owned union.
        unionWageDemand: coveringIndustryUnionDoc?.ownerId
          ? (coveringIndustryUnionDoc.demandedWageLevel ?? null)
          : null,
        unionId: coveringIndustryUnionDoc?._id?.toString() ?? null,
        unionName: coveringIndustryUnionDoc?.name ?? null,
        // Union dues v1: who holds THIS sector, as opposed to who organizes the
        // industry. Null means unrepresented, so a drive here is a first claim
        // rather than a raid. A representingUnionId pointing at a union that no
        // longer exists reads as unrepresented rather than as a phantom holder.
        representingUnionId: representingUnionDoc ? sector.representingUnionId?.toString() : null,
        representingUnionName: representingUnionDoc?.name ?? null,
        createdAt: sector.createdAt,
        // For-sale listing, null when not listed. priceAnchor / npvAnchor are
        // ₳-denominated so the UI formatter routes through the viewer's wallet
        // preference, matching every other anchor-shipped money field.
        forSale: sector.forSale
          ? {
              listedAt: sector.forSale.listedAt,
              priceAnchor: sector.forSale.priceAnchor,
              npvAnchor: sector.forSale.npvAnchor,
            }
          : null,
      },
      corporation: {
        _id: corporation._id,
        sequentialId: corporation.sequentialId,
        name: corporation.name,
        brandColor: corporation.brandColor,
        logoUrl: corporation.logoUrl ?? null,
        // Sector money fields (revenue, growthCost, profit, tax approximations)
        // are denominated in the corp's home currency. UI uses this code with
        // formatAmount so wallet preference still governs final rendering.
        liquidCurrencyCode: corporation.liquidCurrencyCode ?? null,
        // State-owned (NatCorp) sectors can't be attacked, the UI hides Market
        // Actions accordingly (backend already rejects the attack). Bug #0775.
        isStateOwned: isStateOwned(corporation),
        // Drives the Prospect modal's success-odds / yield preview (corp-side
        // prospecting math is a pure function of rdScore).
        rdScore: corporation.rdScore ?? 0,
      },
      ceo: ceo
        ? { name: ceo.name, sequentialId: ceo.sequentialId, avatarUrl: ceo.avatarUrl }
        : null,
      pricing,
      capital,
      // Plants tier: null in every world below `marketSystemMode >= "plants"`,
      // which is the flag the page switches its whole layout on.
      plantsEnabled,
      plants,
      commodities: {
        supplies,
        demands: demandsWithShortage,
        commodityMarginModifier: mods.commodityModifier,
        commoditySupplyDemandBlendPct: blendPct,
        priceRealization,
        throughput,
      },
      margins: {
        base: sector.profitMargin,
        ...mods,
        // computeSectorMarginSection already folds crises into both the
        // displayed margin and the maintenance/profit calculation.
        effective: mods.effective,
        crisisMarginPenalty: Math.round(crisisMarginPenalty * 10) / 10,
        activeCrises,
        commoditySupplyDemandBlendPct: blendPct,
        // Raw metric values for display context
        unemploymentRate: r(metrics.unemploymentRate),
        gridReliability: r(metrics.gridReliability),
        corruptionIndex: r(metrics.corruptionIndex),
        workforceSkill: r(metrics.workforceSkill),
        crimeRate: metrics.crimeRate != null ? Math.round(metrics.crimeRate) : null,
        broadbandAccess: r(metrics.broadbandAccess),
        roadCondition: r(metrics.roadCondition),
        carbonEmissions: r(metrics.carbonEmissions),
        costOfLiving: r(metrics.costOfLiving),
        // National-level macroeconomic raw values for display
        inflationRate: r(macroEcon.inflationRate),
        debtToGdpRatio: r(macroEcon.debtToGdpRatio != null ? macroEcon.debtToGdpRatio * 100 : null),
        deficitToGdpPct: r(
          macroEcon.surplusToGdpRatio != null ? -macroEcon.surplusToGdpRatio * 100 : null
        ),
      },
      financials: {
        revenue: Math.round(sectorAmountInCorpCurrency(sector.revenue)),
        // Realized revenue after every realization leg (capacity, clearing,
        // throughput, capital, strike, embargo). Surfaced so the detail page can
        // show the gap between nameplate and realized income, e.g. an embargo
        // haircut, instead of being embargo-blind (ticket 984).
        realizedRevenue: Math.round(sectorAmountInCorpCurrency(sectorEconomicRevenue(sector))),
        embargoSuspended: sector.embargoSuspended ?? false,
        // Maintenance shown net of labour; the wage slice is broken out as `laborCost`.
        maintenance: Math.round(sectorAmountInCorpCurrency(maintenanceNet)),
        laborCost: Math.round(sectorAmountInCorpCurrency(sectorLaborCost)),
        growthCost: Math.round(sectorAmountInCorpCurrency(sector.currentGrowthCost)),
        techGrowthCostReductionPct: computeTechGrowthCostReductionPct({
          techTreesEnabled,
          techCurrentYear,
          techCorpView,
          sectorType,
        }),
        profit: Math.round(sectorAmountInCorpCurrency(profit)),
        // Rates displayed to the player are whichever side (domestic/foreign) actually applies
        // to THIS sector based on the corp's HQ country vs the sector's country.
        federalTaxRate: sectorFederalRate,
        stateTaxRate: sectorStateRate,
        // Per-sector apportioned tax: matches corp-page math (revenue-weighted share of
        // corp-level overhead allocated to each sector, remainder taxed at country/state
        // rate). Sibling weighting now uses the same realized-preferring basis
        // (sectorEconomicRevenue) the corp page weights its siblings by, so the two pages
        // no longer disagree over a haircut sibling. Sibling profits still use raw margins
        // here (no state-modifier recomputation), so the total can still differ slightly
        // from the corp-page aggregate for that separate reason.
        federalTaxApprox: Math.round(sectorAmountInCorpCurrency(apportionedFederalTax)),
        stateTaxApprox: Math.round(sectorAmountInCorpCurrency(apportionedStateTax)),
        // This sector's revenue-weighted share of corp-level overhead (marketing +
        // logistics + CEO salary), and the taxable income that remains after it.
        // Surfaced so a zero tax on a profitable-looking sector is self-explanatory:
        // when overhead exceeds operating profit, taxable income is floored at 0.
        corpOverheadShare: Math.round(
          sectorAmountInCorpCurrency(corpLevelCosts * thisRevenueShare)
        ),
        taxableIncome: Math.round(sectorAmountInCorpCurrency(thisSectorTaxable)),
      },
      market: {
        totalMarket: effectiveMarket,
        marketShare,
        competitors,
        unownedRevenue: Math.round(unownedRevenue),
        unownedPercent,
      },
      isCeo,
      labourEnabled: labourWagesEnabled,
      // Gates the union-busting UI panel; that mechanic requires "full" tier,
      // one above the wage-slider's "wages" tier.
      labourFullEnabled: await isLabourFullMode(),
      // Gates the CEO Prospect action on extraction sectors (per-surface flag
      // convention: the page reads its own GET, no separate flags endpoint).
      prospectingEnabled: await isProspectingEnabled(),
      stateResources: stateResources ?? null,
      // Extraction only, per-resource deposit view for the sector's state:
      // capacity, total desired output across the state's extraction sectors,
      // and headroom (capacity − desired; negative = oversubscribed). null for
      // non-extraction sectors and uncapped states.
      extractionCapacity:
        sectorType === "extraction" && stateResources
          ? buildDepositCapacityRows(stateResources, extractionDesiredByResource)
          : null,
      // Signpost: other states with free capacity for this sector's binding
      // resource(s). null when the sector isn't capacity-bound or nowhere has
      // headroom. Read-only guidance (see computeResourceOpportunities).
      extractionOpportunities,
      attackInfo: viewerCorporation
        ? buildSectorAttackInfo({
            viewerCorporation,
            defenderMarketingStrength: corporation.marketingStrength ?? 0,
            viewerCorpFxRate,
            sectorHostFxRate,
            sectorHostLiquidCode,
            sector,
            sectorType,
            sectorCountryId,
            allTariffs,
            activeFtaPairs,
            unownedRevenue,
            effectiveMarket,
            mods,
            siblingsSectors,
            siblingRevenueAnchorById,
            plantsMode: plantsEnabled,
          })
        : null,
      forSaleInfo: await buildSectorForSaleInfo(db, {
        sector,
        viewerCorporation,
        isCeo,
        viewerCorpFxRate,
      }),
      strategy: buildSectorStrategySection({
        sector,
        sectorType,
        effectiveRates,
        transitionProgress,
        strategyTransitionMod,
        currentTurn,
        sectorHostLiquidCode,
        sectorHostFxRate,
        commodityPrices,
        techCorpView,
        techCurrentYear,
        techTreesEnabled,
        shouldRedact,
        stateResources,
        strategyCapacityMultipliers,
        // Same market state the live sector's own modifier was computed from,
        // so each candidate strategy's projection is directly comparable to it.
        marginProjection: {
          globalBalances,
          nationalBalances: nationalBalancesByCountry.get(sectorCountryId) ?? new Map(),
          stateBalances,
          globalWeight: tariffBlend.globalWeight,
          nationalWeight: tariffBlend.nationalWeight,
          localWeight: tariffBlend.localWeight,
          currentCommodityModifier: mods.commodityModifier,
          currentRealization: priceRealization?.projected ?? null,
        },
      }),
    };

    // Financial visibility banner. When money figures are withheld, the client
    // used to receive bare nulls and render ", " in every stat cell, which reads
    // as "this sector earns $0 / is broken" rather than "you are not allowed to
    // see this". Every hidden-data branch now attaches a reason the UI labels,
    // so a withheld value is never mistaken for a real zero. Admins and the
    // owning CEO fall through with `hidden: false`, they are never fogged (see
    // `isInsider`); this object exists to explain the OTHER cases, not to add a
    // gate.
    payload.financialVisibility = { hidden: false, reason: "visible" };

    // Private corps: redact sensitive financial data but keep attack/split/market
    // info visible so the viewer can still interact with the sector.
    if (shouldRedact) {
      (payload.sector as Record<string, unknown>).revenue = null;
      (payload.sector as Record<string, unknown>).currentGrowthCost = null;
      (payload.sector as Record<string, unknown>).workers = null;
      (payload.sector as Record<string, unknown>).workersDesired = null;
      (payload.sector as Record<string, unknown>).labourStaffingFactor = null;
      payload.corporation = redactPrivateCorporation(
        payload.corporation as Record<string, unknown>
      );
      payload.margins = null;
      payload.financials = null;
      payload.ceo = null;
      payload.financialVisibility = {
        hidden: true,
        reason: user ? "private-corp" : "signed-out",
      };
    } else if (publicFinancialFog) {
      // Public corps still keep identity/CEO/attack-split info visible, only
      // live financial performance is hidden from non-insiders here.
      (payload.sector as Record<string, unknown>).revenue = null;
      (payload.sector as Record<string, unknown>).currentGrowthCost = null;
      (payload.sector as Record<string, unknown>).workers = null;
      (payload.sector as Record<string, unknown>).workersDesired = null;
      (payload.sector as Record<string, unknown>).labourStaffingFactor = null;
      payload.margins = null;
      payload.financials = null;
      payload.financialVisibility = {
        hidden: true,
        reason: user ? "public-rival" : "signed-out",
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    return handleRouteError(error);
  }
}
