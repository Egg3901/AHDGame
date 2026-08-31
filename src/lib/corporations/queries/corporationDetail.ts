import { ObjectId, type Db } from "mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type {
  Character,
  Corporation,
  CorporateSector,
  FederalBudget,
  Bond,
  Shareholder,
  ShareListing,
  ShareOrder,
  StateResourceCapacity,
  UnownedSector,
  User,
  GameState,
} from "@/lib/db/types";
import type { IndexFund } from "@/lib/db/types/indexFund";
import {
  indexFundOwnershipFraction,
  qualifiesForIndexInclusionBenefit,
} from "@/lib/corporations/indexOwnership";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { buildPoliticalBaseModifiers } from "@/lib/politicalLegislation/marginAdapter";
import { INACTIVE_CEO_TURN_THRESHOLD } from "@/lib/turn/corporation/inactiveCeoSectorShed";
import { computeTechAssetValueAnchor } from "@/lib/corporations/techAssetValue";
import {
  getSectorTechEffectsForYear,
  getSectorTechEffects,
} from "@/lib/constants/techTree/selectors";
import { buildMarketShareBySectorId } from "@/lib/corporations/marketShare";
import { resolvePresetIdFromGameState } from "@/lib/world/countryReadinessContract";
import { getEraFounderShares } from "@/lib/constants/sectorSeedEra";
import { ceoSelfAcquisitionWindow } from "@/lib/corporations/ceoShareAcquisitionCap";
import { caretakerReappointCooldownRemaining } from "@/lib/corporations/caretakerCeo";
import {
  CEO_SELF_ACQUISITION_CAP_FRACTION,
  CEO_SELF_ACQUISITION_WINDOW_TURNS,
} from "@/lib/constants/corporations";
import { computeAccountedShares } from "@/lib/corporations/shareInvariant";
import {
  corporationWithReservedHoldings,
  loadReservedPositionsPlacedBy,
  reservedCorporatePositions,
} from "@/lib/corporations/reservedCorporateHoldings";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import { seedPlantLedger } from "@/lib/corporations/plantLedger";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import { perTurnCouponPayment } from "@/lib/constants/bonds";
import { getBondIssuerDisplayName } from "@/lib/bonds/sovereign";
import { loyaltyLabel } from "@/lib/market/brandLoyalty";
import { BOND_UNIT_FACE_VALUE } from "@/lib/db/types/bond";
import {
  getForeignTariffMarginModifier,
  getDomesticTariffMalus,
  getTariffBlendWeights,
  buildSectorPresenceKeys,
  tariffRulesNeedSectorPresenceKeys,
} from "@/lib/tariffs/tariffEffects";
import { getTurnReferenceData } from "@/lib/corporations/turnReferenceData";
import { marginEffectForModifier } from "@/lib/states/conditions/marginEffects";
import { buildFtaCoverageLookup } from "@/lib/tariffs/ftaOverrides";
import { getSubsidyMarginModifier } from "@/lib/subsidies/subsidyEffects";
import {
  anchorToCorpCapital,
  corpCapitalToAnchor,
  corpLiquidCapitalToAnchor,
  fxRateForCorpFromMap,
  loadValuationFxRates,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import {
  CORPORATION_TYPE_LABELS,
  TURNS_PER_DAY,
  NPV_ANNUAL_DISCOUNT_RATE,
  MIN_SHARE_PRICE,
  TYPE_SWITCH_PENALTY_TURNS,
  computeAllMarginModifiers,
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  calculateWorkers,
  SHARE_STRUCTURE_COOLDOWN_TURNS,
  SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
  CEO_INITIAL_SHARES,
  MAX_DIVIDEND_RATE,
  getDominanceRegulatoryBurden,
  getExpropriationRiskMarginModifier,
  softCapEffectiveMargin,
} from "@/lib/constants/corporations";
import {
  acquirerOwnershipPercent,
  getControllingCorporateParent,
  HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT,
  SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT,
} from "@/lib/corporations/corporateOwnership";
import { canActOnCorporationAsParent } from "@/lib/corporations/subsidiaries/authorization";
import {
  activeParentDividendFloorPct,
  isEligibleAsSubsidiary,
  isEligibleAsSubsidiaryParent,
  isFormalizedSubsidiary as isFormalizedSubsidiaryHelper,
} from "@/lib/corporations/subsidiaries/helpers";
import type {
  CorporationType,
  StateMetricValues,
  MacroEconomicValues,
} from "@/lib/constants/corporations";
import { computeBlendedMarginModifiers } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeSoeEfficiencyPenalty } from "@/lib/nationalization/soeEfficiency";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { sociMultiplier } from "@/lib/nationalization/concentration";
import { resolveSectorMandate } from "@/lib/nationalization/soeMandates";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { getRoundedPublicMarketCap, getPublicShareQuote } from "@/lib/corporations/marketQuote";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import { findImfFacilityReceivablesForLender } from "@/lib/corporations/imfPortfolioReceivables";
import {
  employerPensionCostForTurn,
  EMPTY_EMPLOYER_PENSION_COST,
} from "@/lib/pensions/employerPensionCosts";
import {
  anchorPerTurnToFinancialDaily,
  imfFacilityPaymentAnchorPerTurn,
  sumImfLenderReceiptsAnchorPerTurnForReceivables,
} from "@/lib/imf/imfFacilityFinancials";
import { calculateCorpStrengthProjection } from "@/lib/corporations/strengthProjection";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import { fetchBordersByUserIds } from "@/lib/db/patreonBorders";
import { computeStateMetricMarginModifier } from "@/lib/corporations/sectorMetricMarginProfiles";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { resolveGameYear } from "@/lib/era/era";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";
import {
  getEffectiveStrategyRates,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
  STRATEGY_TRANSITION_TURNS,
} from "@/lib/constants/sectorStrategies";
import { getRevenueMultiplier, getInputMultiplier } from "@/lib/utils/productionPolicy";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { buildNationalCommodityBalances } from "@/lib/commodity-map";
import { isLabourWagesEnabled } from "@/lib/labour/featureFlag";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  CORP_GROWTH_TARGET_SPAN_TURNS,
  computeCorpRealizedGrowthRate,
} from "@/lib/corporations/realizedGrowth";
import { computeFillRate, fillRateBand } from "@/lib/corporations/financialFogOfWar";
import { summarizeBuildQueue } from "@/lib/corporations/sectorBuildQueue";
import { readPlantsPnl } from "@/lib/corporations/plantsPnlBasis";

function getEmptyStateMetricValues(): StateMetricValues {
  return {
    fullMetrics: null,
    unemploymentRate: null,
    gridReliability: null,
    corruptionIndex: null,
    workforceSkill: null,
    crimeRate: null,
    broadbandAccess: null,
    roadCondition: null,
    carbonEmissions: null,
    costOfLiving: null,
  };
}

async function loadShareholderContext(db: Db, corporation: Corporation) {
  const shareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.characterId)
    .filter((id): id is ObjectId => id !== undefined);
  const imperialShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.imperialCharacterId)
    .filter((id): id is ObjectId => id !== undefined);
  const corporationShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.corporationId)
    .filter((id): id is ObjectId => id !== undefined);
  const nppShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.nppId)
    .filter((id): id is ObjectId => id !== undefined);
  const fundShareholderIds = (corporation.shareholders ?? [])
    .map((sh) => sh.fundId)
    .filter((id): id is ObjectId => id !== undefined);

  const isImperialCeo = corporation.ceoType === "imperial";
  const isNppCeo = corporation.ceoType === "npp";
  const ceoPromise = isImperialCeo
    ? db.collection("imperialCharacters").findOne(
        { _id: corporation.ceoId },
        {
          projection: {
            name: 1,
            avatarUrl: 1,
            sequentialId: 1,
            userId: 1,
            homeState: 1,
            countryId: 1,
          },
        }
      )
    : isNppCeo
      ? db.collection("npps").findOne(
          { _id: corporation.ceoId },
          {
            projection: {
              name: 1,
              avatarUrl: 1,
              sequentialId: 1,
              homeState: 1,
              countryId: 1,
            },
          }
        )
      : db.collection<Character>("characters").findOne(
          { _id: corporation.ceoId },
          {
            projection: {
              name: 1,
              avatarUrl: 1,
              sequentialId: 1,
              userId: 1,
              homeState: 1,
              countryId: 1,
            },
          }
        );

  const [
    ceo,
    shareholderChars,
    imperialShareholderChars,
    corporationShareholderCorps,
    nppShareholderDocs,
    fundShareholderDocs,
  ] = await Promise.all([
    ceoPromise,
    shareholderIds.length > 0
      ? db
          .collection<Character>("characters")
          .find(
            { _id: { $in: shareholderIds } },
            {
              projection: {
                _id: 1,
                name: 1,
                sequentialId: 1,
                avatarUrl: 1,
                userId: 1,
                homeState: 1,
                countryId: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([] as Character[]),
    imperialShareholderIds.length > 0
      ? db
          .collection("imperialCharacters")
          .find(
            { _id: { $in: imperialShareholderIds } },
            {
              projection: {
                _id: 1,
                name: 1,
                sequentialId: 1,
                avatarUrl: 1,
                userId: 1,
                homeState: 1,
                countryId: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
    corporationShareholderIds.length > 0
      ? db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: corporationShareholderIds } },
            { projection: { _id: 1, name: 1, sequentialId: 1, logoUrl: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Corporation[]),
    nppShareholderIds.length > 0
      ? db
          .collection<{ _id: ObjectId; name: string }>("npps")
          .find({ _id: { $in: nppShareholderIds } }, { projection: { _id: 1, name: 1 } })
          .toArray()
      : Promise.resolve([] as { _id: ObjectId; name: string }[]),
    fundShareholderIds.length > 0
      ? db
          .collection<Pick<IndexFund, "_id" | "name" | "slug" | "scope" | "countryId">>(
            "indexFunds"
          )
          .find(
            { _id: { $in: fundShareholderIds } },
            { projection: { _id: 1, name: 1, slug: 1, scope: 1, countryId: 1 } }
          )
          .toArray()
      : Promise.resolve([] as Pick<IndexFund, "_id" | "name" | "slug" | "scope" | "countryId">[]),
  ]);

  const allCorpUserIds = [
    ...(ceo?.userId ? [ceo.userId] : []),
    ...shareholderChars.filter((c) => c.userId).map((c) => c.userId),
    ...imperialShareholderChars.filter((c) => c.userId).map((c) => c.userId),
  ];
  const corpBorderMap = await fetchBordersByUserIds(db, allCorpUserIds);

  const shareholderNameMap = new Map<
    string,
    {
      name: string;
      sequentialId?: number;
      avatarUrl?: string;
      borderKey: string | null;
      tintColor: string | null;
      isImperial?: boolean;
      homeState?: string;
      countryId?: string;
    }
  >();
  for (const c of shareholderChars) {
    shareholderNameMap.set(c._id.toString(), {
      name: c.name,
      sequentialId: c.sequentialId,
      avatarUrl: c.avatarUrl,
      borderKey: c.userId ? (corpBorderMap.get(c.userId.toString())?.borderKey ?? null) : null,
      tintColor: c.userId ? (corpBorderMap.get(c.userId.toString())?.tintColor ?? null) : null,
      homeState: c.homeState,
      countryId: c.countryId,
    });
  }
  for (const ic of imperialShareholderChars) {
    shareholderNameMap.set(ic._id.toString(), {
      name: ic.name,
      sequentialId: ic.sequentialId,
      avatarUrl: ic.avatarUrl,
      borderKey: ic.userId ? (corpBorderMap.get(ic.userId.toString())?.borderKey ?? null) : null,
      tintColor: ic.userId ? (corpBorderMap.get(ic.userId.toString())?.tintColor ?? null) : null,
      isImperial: true,
      homeState: ic.homeState,
      countryId: ic.countryId,
    });
  }

  const corporationShareholderNameMap = new Map(
    corporationShareholderCorps.map((c) => [
      c._id.toString(),
      { name: c.name, sequentialId: c.sequentialId, logoUrl: c.logoUrl },
    ])
  );

  const nppShareholderNameMap = new Map<string, { name: string }>(
    nppShareholderDocs.map((n: { _id: ObjectId; name: string }) => [
      n._id.toString(),
      { name: n.name },
    ])
  );

  const fundShareholderNameMap = new Map<
    string,
    { name: string; slug: string; scope: IndexFund["scope"]; countryId?: string }
  >(
    fundShareholderDocs.map((f) => [
      f._id.toString(),
      { name: f.name, slug: f.slug, scope: f.scope, countryId: f.countryId },
    ])
  );

  return {
    isImperialCeo,
    isNppCeo,
    ceo,
    shareholderNameMap,
    corporationShareholderNameMap,
    nppShareholderNameMap,
    fundShareholderNameMap,
    corpBorderMap,
  };
}

async function buildHostileTakeoverEligibility(
  db: Db,
  corporation: Corporation,
  viewerUserId: string | null | undefined
) {
  if (!viewerUserId || corporation.countryOwnerId) return null;

  const myCorps = await db
    .collection<Corporation>("corporations")
    .find({
      userId: new ObjectId(viewerUserId),
      ceoVacant: { $ne: true },
      countryOwnerId: { $exists: false },
    })
    .project({ _id: 1 })
    .toArray();

  // Valuation map, not the settlement map: this value is DISPLAYED and RANKED.
  // The settlement map leaves the six bloc currencies (PLZ/CSK/HUF/YUD/BGL/ROL,
  // 102 corps) missing on purpose, which converted them at 1.0. See
  // corporationCapital.ts.
  const fxByCurrency = await loadValuationFxRates(db);
  for (const mc of myCorps) {
    const acqPct = acquirerOwnershipPercent(mc._id, corporation);
    if (acqPct > HOSTILE_TAKEOVER_OWNERSHIP_THRESHOLD_PERCENT) {
      const [outstandingBonds, parentCorp] = await Promise.all([
        db
          .collection<Bond>("bonds")
          .find({ corporationId: corporation._id, matured: false })
          .toArray(),
        db.collection<Corporation>("corporations").findOne({ _id: mc._id }),
      ]);
      const outstandingBondDebt = outstandingBonds.reduce((sum, b) => sum + b.totalIssued, 0);
      const parentFx = parentCorp ? fxRateForCorpFromMap(parentCorp, fxByCurrency) : 1;
      const parentLiquidAnchor = parentCorp
        ? corpLiquidCapitalToAnchor(parentCorp.liquidCapital, parentCorp, parentFx)
        : 0;
      const parentCurrency = parentCorp
        ? (COUNTRY_CURRENCY_MAP[parentCorp.countryId] ?? "USD")
        : "USD";

      return {
        parentCorporationId: mc._id.toString(),
        ownershipPct: Math.round(acqPct * 100) / 100,
        outstandingBonds: outstandingBonds.length,
        outstandingBondDebt,
        parentLiquidCapital: parentLiquidAnchor,
        parentLiquidCurrencyCode: parentCurrency,
      };
    }
  }

  return null;
}

export async function loadCorporationDetailView(args: {
  db: Db;
  corporation: Corporation;
  currentTurn: number;
  viewerUserId?: string | null;
}) {
  const { db, corporation, currentTurn, viewerUserId } = args;

  const refDataPromise = getTurnReferenceData(db, currentTurn);

  const [openListingsForInvariant, openSellOrdersForInvariant] = await Promise.all([
    db
      .collection<ShareListing>("shareListings")
      .find({ corporationId: corporation._id, status: "open" })
      .toArray(),
    db
      .collection<ShareOrder>("shareOrders")
      .find({
        corporationId: corporation._id,
        type: "sell",
        status: "open",
        placerCorporationId: { $exists: true },
      })
      .toArray(),
  ]);
  const reservedHoldings = reservedCorporatePositions(
    openSellOrdersForInvariant,
    openListingsForInvariant,
    corporation._id
  );
  const corporationForControl = corporationWithReservedHoldings(corporation, reservedHoldings);

  const {
    isImperialCeo,
    isNppCeo,
    ceo,
    shareholderNameMap,
    corporationShareholderNameMap,
    nppShareholderNameMap,
    fundShareholderNameMap,
    corpBorderMap,
  } = await loadShareholderContext(db, corporationForControl);

  // CEO self-acquisition window — surfaced to the CEO's own user so the buy
  // modal can show used/remaining/countdown before they attempt a capped buy.
  let ceoShareWindow: {
    capShares: number;
    acquiredShares: number;
    remainingShares: number;
    freesUpInTurns: number;
    capPercent: number;
    windowTurns: number;
  } | null = null;
  if (
    viewerUserId &&
    corporation.userId?.toString() === viewerUserId &&
    corporation.ceoVacant !== true &&
    corporation.ceoId
  ) {
    const w = await ceoSelfAcquisitionWindow(
      db,
      corporation,
      corporation.ceoId,
      isImperialCeo ? "imperialCharacterId" : "characterId",
      currentTurn
    );
    ceoShareWindow = {
      capShares: w.capShares,
      acquiredShares: w.acquiredShares,
      remainingShares: w.remainingShares,
      freesUpInTurns: w.freesUpInTurns,
      capPercent: Math.round(CEO_SELF_ACQUISITION_CAP_FRACTION * 100),
      windowTurns: CEO_SELF_ACQUISITION_WINDOW_TURNS,
    };
  }

  // Derive ceoIsInactive from the CEO-owning user's lastActivity (or createdAt fallback).
  // Same exclusions as inactiveCeoSectorShed.isInactiveCeoPenaltyCandidate except this
  // query does not skip ceoType === "npp". NPP-run corps can show as inactive here
  // even though the turn shed never acts on them.
  const INACTIVE_CEO_THRESHOLD_MS = INACTIVE_CEO_TURN_THRESHOLD * 60 * 60 * 1000;
  let ceoIsInactive = false;
  if (
    !isImperialCeo &&
    corporation.ceoVacant !== true &&
    corporation.userId != null &&
    corporation.countryOwnerId == null &&
    corporation.isNationalized !== true
  ) {
    const ceoUser = await db
      .collection<User>("users")
      .findOne({ _id: corporation.userId }, { projection: { lastActivity: 1, createdAt: 1 } });
    const reference = ceoUser?.lastActivity ?? ceoUser?.createdAt;
    if (reference && reference.getTime() < Date.now() - INACTIVE_CEO_THRESHOLD_MS) {
      ceoIsInactive = true;
    }
  }

  const [refData, sectors, allSectorsRaw] = await Promise.all([
    refDataPromise,
    db
      .collection<CorporateSector>("corporateSectors")
      .find({ corporationId: corporation._id })
      .toArray(),
    db
      .collection<CorporateSector>("corporateSectors")
      .find({}, { projection: { corporationId: 1, countryId: 1, sectorType: 1, revenue: 1 } })
      .toArray(),
  ]);
  const {
    commodityPrices,
    allStates,
    allTariffs,
    activeFtaPairs,
    activeSubsidies,
    exchangeRateDocs,
    stateBudgetsForTax,
  } = refData;

  const sectorLookupCorpIds = [...new Set(allSectorsRaw.map((s) => s.corporationId.toString()))];
  const sectorLookupCorps =
    sectorLookupCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: sectorLookupCorpIds.map((cid) => new ObjectId(cid)) } },
            { projection: { _id: 1, countryId: 1 } }
          )
          .toArray()
      : [];
  const corpByIdForTariffs = new Map(sectorLookupCorps.map((corp) => [corp._id.toString(), corp]));
  const blendPresenceKeys = tariffRulesNeedSectorPresenceKeys(allTariffs)
    ? buildSectorPresenceKeys(allSectorsRaw, corpByIdForTariffs)
    : new Set<string>();
  const ftaCoverage = buildFtaCoverageLookup(allSectorsRaw, corpByIdForTariffs, activeFtaPairs);

  const allStateIds = [corporation.headquartersState, ...sectors.map((s) => s.stateId)];
  const uniqueStateIds = [...new Set(allStateIds)];
  const uniqueStateIdSet = new Set(uniqueStateIds);
  const [stateMetricsDocs, stateResourceCapacityDocs, gameState] =
    uniqueStateIds.length > 0
      ? await Promise.all([
          // Legacy-shaped view for the margin engine's stored reads.
          findMergedRegionMetricsMany(db, { _id: { $in: uniqueStateIds } }),
          db
            .collection<StateResourceCapacity>("stateResourceCapacity")
            .find(
              { stateId: { $in: uniqueStateIds } },
              { projection: { stateId: 1, resources: 1 } }
            )
            .toArray(),
          db.collection<GameState>("gameState").findOne(
            { _id: "current" },
            {
              projection: {
                preset: 1,
                currentYear: 1,
                currentTurn: 1,
                startingYear: 1,
                eraSystemEnabled: 1,
              },
            }
          ),
        ])
      : [[], [], null];
  const states = allStates.filter((s) => uniqueStateIdSet.has(s._id));
  // SP4 §4a: political margin overlays for playable regions among this corp's states.
  const politicalDocs =
    uniqueStateIds.length > 0
      ? await db
          .collection<PoliticalMetricsDoc>("politicalMetrics")
          .find({ _id: { $in: uniqueStateIds } })
          .toArray()
      : [];
  const politicalBaseModifiersByState = new Map(
    politicalDocs.map((doc) => [String(doc._id), buildPoliticalBaseModifiers(doc.values)])
  );
  const stateNameMap = new Map(states.map((s) => [s._id, s.name]));
  const stateResourceCapacityByState = new Map(
    stateResourceCapacityDocs.map((doc) => [doc.stateId, doc.resources])
  );
  const stateCountryMap = new Map(allStates.map((s) => [s._id, s.countryId]));

  const countryIds = [...new Set(states.map((s) => s.countryId))];
  const federalBudgets = await db
    .collection<FederalBudget>("federalBudget")
    .find(
      { countryId: { $in: countryIds } },
      {
        projection: {
          countryId: 1,
          "economicFactors.inflationRate": 1,
          debtToGdpRatio: 1,
          surplus: 1,
          gdp: 1,
          "taxRates.domesticCorporateTax": 1,
          "taxRates.foreignCorporateTax": 1,
        },
      }
    )
    .toArray();

  const fxByCurrency = new Map<CurrencyCode, number>(
    exchangeRateDocs.map((r) => [r.currencyCode as CurrencyCode, r.rate])
  );
  if (!fxByCurrency.has("USD")) fxByCurrency.set("USD", 1.0);

  // Every per-sector figure on this page is shown in the corp's home currency,
  // but sector economic fields are stored in each sector's HOST-state currency.
  // Restate host -> ₳ -> corp so the sector rows, totals, profit, and workers all
  // stay single-currency. Identity for domestic sectors (host == corp).
  const pageCorpCcy = resolveCorpLiquidCurrencyCode(corporation);
  const pageCorpRate = fxRateForCorpFromMap(corporation, fxByCurrency);
  const sectorFieldToAnchor = (
    amount: number,
    sector: Pick<CorporateSector, "countryId">
  ): number =>
    readCorpEconomicAnchor(
      amount,
      resolveSectorHostCurrencyCode(sector, corporation),
      fxRateForSectorHostFromMap(sector, corporation, fxByCurrency)
    );
  const sectorFieldToCorpCcy = (
    amount: number,
    sector: Pick<CorporateSector, "countryId">
  ): number =>
    writeCorpEconomicLocal(sectorFieldToAnchor(amount, sector), pageCorpCcy, pageCorpRate);

  const macroByCountry = new Map<string, MacroEconomicValues>(
    federalBudgets.map((b) => [
      b.countryId,
      {
        inflationRate: b.economicFactors?.inflationRate ?? null,
        debtToGdpRatio: b.debtToGdpRatio ?? null,
        surplusToGdpRatio: b.gdp ? (b.surplus ?? 0) / b.gdp : null,
      },
    ])
  );
  // Per-country investor confidence for the expropriation-risk display (spec §12.4
  // feed 1) — same source the turn reads, so display and turn stay aligned.
  const investorConfidenceByCountry = new Map<string, number | undefined>(
    federalBudgets.map((b) => [b.countryId, b.investorConfidence])
  );
  // Per-country SOCI for the SOE overreach term — same source the turn reads.
  const sociByCountry = new Map<string, number>(
    federalBudgets.map((b) => [b.countryId, b.stateOwnershipConcentration ?? 0])
  );

  const stateMetricsMap = new Map<string, StateMetricValues>(
    stateMetricsDocs.map((sm) => [
      String(sm._id),
      {
        fullMetrics: sm,
        unemploymentRate: sm.economic?.unemploymentRate?.value ?? null,
        gridReliability: sm.infrastructure?.powerGridReliability?.value ?? null,
        corruptionIndex: sm.governance?.corruptionIndex?.value ?? null,
        workforceSkill: sm.education?.workforceSkill?.value ?? null,
        crimeRate: sm.publicSafety?.crimeRate?.value ?? null,
        broadbandAccess: sm.infrastructure?.broadbandAccess?.value ?? null,
        roadCondition: sm.infrastructure?.roadCondition?.value ?? null,
        carbonEmissions: sm.environment?.carbonEmissions?.value ?? null,
        costOfLiving: sm.economic?.costOfLiving?.value ?? null,
      },
    ])
  );

  const globalBalances = new Map<CommodityType, { supply: number; demand: number }>();
  const nationalBalancesByCountry = new Map<
    string,
    Map<CommodityType, { supply: number; demand: number }>
  >();
  const rawStateBalances = new Map<
    string,
    Map<CommodityType, { supply: number; demand: number }>
  >();
  const corpStateIdSet = new Set(uniqueStateIds);
  for (const cp of commodityPrices) {
    globalBalances.set(cp.commodity, { supply: cp.globalSupply, demand: cp.globalDemand });

    const perCountry = buildNationalCommodityBalances(cp, stateCountryMap);
    for (const [countryId, balance] of perCountry) {
      if (!nationalBalancesByCountry.has(countryId)) {
        nationalBalancesByCountry.set(countryId, new Map());
      }
      nationalBalancesByCountry.get(countryId)!.set(cp.commodity, balance);
    }

    for (const stateId of corpStateIdSet) {
      const supply = cp.stateSupply[stateId] ?? 0;
      const demand = cp.stateDemand[stateId] ?? 0;
      if (!rawStateBalances.has(stateId)) {
        rawStateBalances.set(stateId, new Map());
      }
      rawStateBalances.get(stateId)!.set(cp.commodity, { supply, demand });
    }
  }

  // Build a per-sector market-share lookup for this corp's buckets so the
  // dominance margin penalty (applied by the turn loop on growth-cost math)
  // also shows up in the displayed effective profit margin. We only query
  // the (state, sectorType) buckets this corp actually operates in.
  const corpBuckets = sectors.map((s) => ({
    stateId: s.stateId,
    sectorType: s.sectorType,
  }));
  const bucketFilter =
    corpBuckets.length > 0
      ? { $or: corpBuckets.map((b) => ({ stateId: b.stateId, sectorType: b.sectorType })) }
      : null;

  const [siblingSectors, unownedSectors] = bucketFilter
    ? await Promise.all([
        db.collection<CorporateSector>("corporateSectors").find(bucketFilter).toArray(),
        db.collection<UnownedSector>("unownedSectors").find(bucketFilter).toArray(),
      ])
    : [[] as CorporateSector[], [] as UnownedSector[]];

  const siblingCorpIds = [...new Set(siblingSectors.map((s) => s.corporationId.toString()))];
  const siblingCorps =
    siblingCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find({ _id: { $in: siblingSectors.map((s) => s.corporationId) } })
          .project<Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">>({
            _id: 1,
            liquidCurrencyCode: 1,
            countryId: 1,
          })
          .toArray()
      : [];

  const corpById = new Map<string, Pick<Corporation, "_id" | "liquidCurrencyCode" | "countryId">>(
    siblingCorps.map((c) => [c._id.toString(), c])
  );
  // Ensure THIS corp is in the map even if no siblings returned (e.g. solo monopoly).
  corpById.set(corporation._id.toString(), {
    _id: corporation._id,
    liquidCurrencyCode: corporation.liquidCurrencyCode,
    countryId: corporation.countryId,
  });

  const stateById = new Map(
    states.map((s) => [s._id, { _id: s._id, gdp: s.gdp ?? 0, countryId: s.countryId }])
  );

  const marketShareBySectorId = buildMarketShareBySectorId({
    sectors: siblingSectors.length > 0 ? siblingSectors : sectors,
    corpById,
    stateById,
    unownedSectors,
    exchangeRatesByCurrency: fxByCurrency,
    // Era-correct GDP→₳ normalization for the GDP-derived market fallback
    // (refs #3778). `gameState` is already projected with `preset` above.
    preset: resolvePresetIdFromGameState(gameState),
  });

  const techCorpView = {
    type: corporation.type,
    unlockedTechNodeIds: corporation.unlockedTechNodeIds,
    techDecadeLane: corporation.techDecadeLane,
  };
  const currentYear = gameState?.currentYear;

  // Realization-vs-nameplate reconciliation (#2958): `sector.revenue` is a DAILY
  // NAMEPLATE baseline written by turn processing (sectorTurn.ts), before the
  // realized-output multipliers (market clearing / sold-fraction, capacity
  // haircut, throughput, capital utilization, strikes, embargo suspension) that
  // the turn processor applies on top to get the actually-realized
  // `hourlyRevenue` — which is what's summed into `CorporationHistory.revenue`,
  // which is what the Revenue/Costs chart plots. This query used to multiply
  // nameplate revenue by only `revenueMultiplier` (the production-policy dial)
  // and call that "Gross Revenue" — overstating revenue for any corp with
  // unsold/clearing-haircut output (exactly ticket #925: oversupplied sectors
  // with low sold%, chart shows a loss, live Financials shows a large profit).
  //
  // Exactly replicating the turn processor's per-sector realization math here
  // would duplicate a large, mode-gated computation (clearing/capacity/
  // throughput/capital tiers) that's already computed correctly once per turn.
  // Instead, derive a single per-corp realization ratio from the corp's own
  // most recent CorporationHistory snapshot (realized hourly revenue ÷
  // nameplate hourly revenue) and apply it uniformly across sectors. This is
  // an approximation for a multi-sector corp with heterogeneous per-sector
  // haircuts, but is a large accuracy improvement over assuming 100%
  // realization, and keeps every downstream Income Statement line
  // (maintenance, growth cost, regulatory burden, subsidy, profit) internally
  // consistent since they all scale off the same corrected `financialRevenue`.
  const latestHistoryForRealization = await db
    .collection<{ revenue?: number }>("corporationHistory")
    .findOne(
      { corporationId: corporation._id },
      { sort: { turn: -1 }, projection: { revenue: 1 } }
    );
  const nameplateHourlyRevenueLocal = sectors.reduce((sum, sector) => {
    const multiplier = getRevenueMultiplier(sector.productionPolicyLevel ?? 0);
    return sum + (sectorFieldToCorpCcy(sector.revenue, sector) * multiplier) / TURNS_PER_DAY;
  }, 0);
  const realizedHourlyRevenueLocal =
    typeof latestHistoryForRealization?.revenue === "number"
      ? latestHistoryForRealization.revenue
      : null;
  // No history yet (brand-new corp) or a degenerate nameplate total ⇒ no
  // correction we can trust; fall back to the pre-fix (nameplate) behavior
  // rather than dividing by ~0 or applying a ratio computed from nothing.
  const revenueRealizationRatio =
    realizedHourlyRevenueLocal != null && nameplateHourlyRevenueLocal > 0
      ? Math.max(0, realizedHourlyRevenueLocal / nameplateHourlyRevenueLocal)
      : 1;

  let totalRevenue = 0;
  let totalMaintenanceCosts = 0;
  let totalGrowthCosts = 0;
  let totalSubsidyBenefit = 0;
  let totalRegulatoryBurden = 0;
  // Labour system (wages on): the persisted per-sector labour cost is carved
  // OUT of the gross maintenance recomputed below (profit-invariant). Accumulate
  // it so the corp Financials tab can show Wages as its own line item and net
  // it out of Sector Maintenance.
  const labourWagesEnabled = await isLabourWagesEnabled();
  let totalLaborCosts = 0;
  const wageBillAnchorPerTurnBySectorId = new Map<string, number>();

  // Plants tier: sectors are PLANTS, so the row's headline numbers become
  // physical (capacity, output, sales) rather than a growth rate. Resolved
  // once here and published on the returned corporation so every client
  // surface reads one flag instead of each guessing from the presence of a
  // field. Below plants this is false and every field added below is null, so
  // a capital-tier world's payload is unchanged apart from the null keys.
  const plantsMode = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  // #922 — "Growth Rate always 0". Under plants, a sector's `currentGrowthRate`
  // no longer drives revenue (revenue comes from produced units against plant
  // capacity), so the field is vestigial and sits at 0 for most corporations.
  // Averaging it and printing it as the corp's growth rate reported 0.00% for
  // everyone. Measure the revenue the corp actually booked instead, over a
  // trailing window wide enough that annualizing does not amplify churn.
  const realizedGrowthRate = plantsMode
    ? computeCorpRealizedGrowthRate(
        (
          await db
            .collection<{ turn?: number; revenue?: number }>("corporationHistory")
            .find(
              { corporationId: corporation._id },
              {
                sort: { turn: -1 },
                limit: CORP_GROWTH_TARGET_SPAN_TURNS + 1,
                projection: { turn: 1, revenue: 1 },
              }
            )
            .toArray()
        ).flatMap((row) =>
          typeof row.turn === "number" && typeof row.revenue === "number"
            ? [{ turn: row.turn, revenue: row.revenue }]
            : []
        )
      )
    : null;

  // Corp-level physical rollups (plants only). These are the physical P&L's
  // top line: what the corporation can make, what it did make, what it sold,
  // and what it has paid for but cannot use yet.
  let totalCapacityUnits = 0;
  let totalProducedUnits = 0;
  let totalSoldUnits = 0;
  let totalConstructionInProgressAnchor = 0;
  let mothballedSectorCount = 0;
  let buildingSectorCount = 0;
  let totalUnitsOnOrder = 0;

  // Lagged global price-over-base ratios, the same map the turn engine feeds
  // computeInputsCost. Used to rebuild the physical input bill per sector so
  // the margin drilldown can explain a physically-derived margin.
  const globalPriceRatioByCommodity = new Map<CommodityType, number>();
  for (const cp of commodityPrices) {
    if (
      typeof cp.globalPrice === "number" &&
      typeof cp.basePrice === "number" &&
      cp.globalPrice > 0 &&
      cp.basePrice > 0 &&
      Number.isFinite(cp.globalPrice / cp.basePrice)
    ) {
      globalPriceRatioByCommodity.set(cp.commodity, cp.globalPrice / cp.basePrice);
    }
  }

  const sectorDetails = sectors.map((sector) => {
    const st = sector.sectorType as CorporationType;
    const metrics = stateMetricsMap.get(sector.stateId) ?? getEmptyStateMetricValues();

    const stateBalances = rawStateBalances.get(sector.stateId) ?? new Map();
    const sectorCountryId =
      sector.countryId ?? stateCountryMap.get(sector.stateId) ?? corporation.countryId;
    const nationalBalances = nationalBalancesByCountry.get(sectorCountryId) ?? new Map();
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      allTariffs,
      sectorCountryId,
      st,
      blendPresenceKeys,
      ftaCoverage
    );
    const commoditySupplyDemandBlendPct = {
      global: Math.round(globalWeight * 10000) / 100,
      national: Math.round(nationalWeight * 10000) / 100,
      local: Math.round(localWeight * 10000) / 100,
    };
    const sectorEffectiveRates = getEffectiveStrategyRates(
      st,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      currentTurn
    );
    const effectiveSupply = applyExtractionResourceCapacityToSupply(
      st,
      sectorEffectiveRates.supply,
      stateResourceCapacityByState.get(sector.stateId)
    );
    const { inputMod, surplusMod } = computeBlendedMarginModifiers(
      st,
      globalBalances,
      nationalBalances,
      stateBalances,
      globalWeight,
      nationalWeight,
      localWeight,
      effectiveSupply,
      sectorEffectiveRates.demand
    );
    const commodityMod = inputMod + surplusMod;

    const corpCountryId = corporation.countryId;
    const homeLocationBonus = getHomeLocationMarginBonus(
      sector.stateId,
      corporation.headquartersState,
      sectorCountryId,
      corpCountryId
    );
    const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
      states.find((s) => s._id === sector.stateId)?.sectorSpecializations,
      st
    );
    const macroEcon = macroByCountry.get(sectorCountryId);
    const typeSwitchPenaltyActive =
      corporation.typeSwitchTurn != null &&
      currentTurn - corporation.typeSwitchTurn < TYPE_SWITCH_PENALTY_TURNS;
    const foreignTariffMod = getForeignTariffMarginModifier(
      allTariffs,
      sectorCountryId,
      st,
      corpCountryId,
      corporation._id,
      activeFtaPairs
    );
    const domesticTariffMod = getDomesticTariffMalus(
      allTariffs,
      sectorCountryId,
      st,
      corpCountryId,
      ftaCoverage
    );
    const subsidyMod = getSubsidyMarginModifier(
      activeSubsidies,
      corporation.headquartersState,
      st,
      sector.stateId,
      sector.strategyId,
      sectorCountryId,
      corpCountryId
    );
    const transitionProgress =
      sectorEffectiveRates.isTransitioning && sector.transitionStartTurn != null
        ? Math.min(
            1,
            Math.max(0, (currentTurn - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
          )
        : 0;
    const strategyTransitionMod = sectorEffectiveRates.isTransitioning
      ? sector.transitionStartTurn != null
        ? transitionProgress * STRATEGY_TRANSITION_MARGIN_PENALTY
        : STRATEGY_TRANSITION_MARGIN_PENALTY
      : 0;
    const sectorMarketSharePct = marketShareBySectorId.get(sector._id.toString()) ?? 0;
    const stateMetricMargin = computeStateMetricMarginModifier({
      sectorType: st,
      strategyId: sector.strategyId ?? "standard",
      transitionFromStrategyId: sector.transitionFromStrategyId,
      transitionProgress,
      stateMetrics: metrics.fullMetrics ?? null,
      // SP4 §4a: political margin overlay for playable regions.
      politicalBaseModifiers: politicalBaseModifiersByState.get(sector.stateId) ?? null,
      countryId: sectorCountryId,
      // Live year for the era existence gate; null while the flag is off.
      year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
    });
    const regionalConditionsModifiers = metrics.fullMetrics
      ? evaluateModifiers(buildFlatMetrics(metrics.fullMetrics), {
          preset: gameState?.preset,
          countryId: metrics.fullMetrics?.countryId ?? sectorCountryId,
          // Live year for era-aware margins; null while the flag is off.
          year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
        }).map((m) => ({
          id: m.id,
          label: m.label,
          effect: m.effect,
          marginEffect:
            m.marginEffect ??
            (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id)),
          source: m.source,
        }))
      : [];
    const regionalConditionsModifier = computeRegionalConditionMargin(regionalConditionsModifiers);
    const mods = computeAllMarginModifiers(
      st,
      sector.profitMargin,
      metrics,
      commodityMod,
      homeLocationBonus,
      corporation.type,
      sectors.length,
      macroEcon,
      corporation.logisticsStrength ?? 0,
      corporation.secondaryType,
      typeSwitchPenaltyActive,
      foreignTariffMod,
      domesticTariffMod,
      subsidyMod,
      strategyTransitionMod,
      stateSectorSpecializationMod,
      sectorMarketSharePct,
      sector.negativeProductionSustainedTurns ?? 0,
      sector.productionPolicyLevel ?? 0,
      {
        total: stateMetricMargin.cappedTotal,
        legacyTotal: stateMetricMargin.legacyTotal,
        contributions: stateMetricMargin.contributions,
        headlineModifiers: stateMetricMargin.headlineModifiers,
      },
      isStateOwned(corporation),
      regionalConditionsModifier,
      regionalConditionsModifiers.map((m) => ({
        label: m.label,
        marginEffect: m.marginEffect ?? 0,
      }))
    );

    const revenueMultiplier = getRevenueMultiplier(sector.productionPolicyLevel ?? 0);
    // Realized revenue for this sector (#3001/#3002). Prefer the exact,
    // per-sector `realizedRevenue` the turn processor now persists (nameplate ×
    // every realization leg, same daily basis + currency as `revenue`). This
    // replaces the legacy uniform per-corp `revenueRealizationRatio` (#2958),
    // which smeared one corp-wide ratio across sectors with heterogeneous
    // haircuts and lagged a turn behind CorporationHistory. The blended ratio
    // survives only as a fallback for sectors not yet reprocessed since the
    // field shipped — a single turn of processing backfills every active sector.
    // Restate this sector's stored (host-currency) fields into the corp's
    // currency so all the per-sector math below is single-currency.
    const sectorRevenueLocal = sectorFieldToCorpCcy(sector.revenue, sector);
    const sectorGrowthCostLocal = sectorFieldToCorpCcy(sector.currentGrowthCost, sector);
    const sectorRealizedRevenueLocal =
      typeof sector.realizedRevenue === "number"
        ? sectorFieldToCorpCcy(sector.realizedRevenue, sector)
        : null;
    const sectorLaborCostLocal =
      typeof sector.laborCost === "number" ? sectorFieldToCorpCcy(sector.laborCost, sector) : null;
    const financialRevenue =
      sectorRealizedRevenueLocal ??
      sectorRevenueLocal * revenueMultiplier * revenueRealizationRatio;
    // Dynamic SOE efficiency (spec §11.3) — same shared function as the turn math
    // and the budget estimate, so display stays aligned. Private corps get 0.
    const soeMandate = resolveSectorMandate(corporation, sector);
    const soeEfficiency = isStateOwned(corporation)
      ? computeSoeEfficiencyPenalty({
          corruptionIndex: metrics.fullMetrics?.governance?.corruptionIndex?.value ?? null,
          governmentTransparency:
            metrics.fullMetrics?.governance?.governmentTransparency?.value ?? null,
          priceControlled: soeMandate.priceControlled === true,
          employmentGuaranteed: soeMandate.employmentGuaranteed === true,
          concentrationMultiplier: sociMultiplier(
            sociByCountry.get(corporation.countryOwnerId ?? "") ?? 0
          ),
        })
      : 0;
    // Expropriation-risk drag (spec §12.4 feed 1) — private corps only, same fn
    // and per-country confidence the turn uses.
    const expropriationRisk = isStateOwned(corporation)
      ? 0
      : getExpropriationRiskMarginModifier(
          investorConfidenceByCountry.get(sectorCountryId) ?? null
        );
    const techEffects =
      currentYear != null
        ? getSectorTechEffectsForYear(techCorpView, st, currentYear)
        : getSectorTechEffects(techCorpView, st);
    const techMarginBonus = techEffects.marginBonusPp;
    const stackMargin = softCapEffectiveMargin(
      mods.effective + soeEfficiency + expropriationRisk + techMarginBonus
    );
    // The margin the engine ACTUALLY applied last turn. Under plants the stored
    // field is an OUTPUT of the physical P&L (sectorTurn.ts P3.5:
    // derivedMarginPct = 100 × (1 − operatingCost/revenue), with labor, upkeep
    // and inputs all inside operatingCost), and this query is its documented
    // reader. The stack recomputed above knows nothing about physical costs —
    // on prod it overstated every corp-484 sector by 20-55pts, inflating the
    // projected income ~2.6x over realized and the balance-sheet sector NPV
    // 2.2x over the capital book the share price uses (ops-knowledge:
    // ahd-corp-sector-npv-divergence). Money uses the engine figure; the stack
    // survives only as the advisory modifier breakdown and as the fallback for
    // legacy sectors that predate the stored field. Below plants the stored
    // value IS last turn's stack, so this is a no-op there.
    const engineMargin =
      typeof sector.effectiveProfitMargin === "number" ? sector.effectiveProfitMargin : null;
    const effectiveProfitMargin = engineMargin ?? stackMargin;
    // Ticket 1122: the turn's own lines when the sector has them, restated into
    // the corp's currency. Inverting `effectiveProfitMargin` cannot be right:
    // it is this P&L's capped OUTPUT, so at the cap it recovers a zero
    // operating cost from a negative one (profit == revenue), and in every case
    // it drops upkeep and compliance, which the margin's scope excludes and the
    // profit includes. The inversion stays as the fallback for rows that
    // predate the field. See `plantsPnlBasis.ts`.
    const enginePnl = readPlantsPnl(sector);
    const maintenance = enginePnl
      ? sectorFieldToCorpCcy(enginePnl.operatingCost, sector)
      : financialRevenue * (1 - effectiveProfitMargin / 100);
    const profit = enginePnl
      ? sectorFieldToCorpCcy(enginePnl.profit, sector)
      : financialRevenue - maintenance - sectorGrowthCostLocal;
    // Physical cost decomposition for the margin drilldown (ticket 1072: the
    // additive modifier list could not explain a physically-derived margin —
    // base + modifiers summed 40pts above the engine figure with no line
    // saying why). Percentage points of REALIZED revenue, mirroring the
    // engine's own cost legs:
    //  - inputs: recipe rates x realized unit prices (priceRealizationFactor,
    //    the same damped/clamped function computeInputsCost bills through),
    //    on the nameplate basis the recipe is expressed against.
    //  - wages: the persisted labor bill.
    //  - other: everything else the engine charged (upkeep, other opex,
    //    financial legs, calibration residual) = the exact remainder, so the
    //    three lines always reconcile to the engine margin.
    // null below plants or when the engine margin / realized revenue are
    // absent — the drilldown falls back to the additive view there.
    const physicalCosts = (() => {
      if (!plantsMode || engineMargin == null) return null;
      const realized = sectorRealizedRevenueLocal;
      if (realized == null || !(realized > 0)) return null;
      // Exact when the turn's lines are on the row: no re-derivation of the
      // input bill, and the policy stack gets its own line instead of hiding
      // inside "other". This is the same decomposition the sector page's money
      // chain now shows, so the two surfaces agree line for line (ticket 1122).
      if (enginePnl && enginePnl.revenue > 0) {
        const pp = (v: number) => Math.round((v / enginePnl.revenue) * 1000) / 10;
        return {
          inputsPp: pp(enginePnl.inputs),
          laborPp: enginePnl.labour > 0 ? pp(enginePnl.labour) : null,
          // Everything else the margin's scope charges, policy credit excluded
          // so it can be named. Upkeep and compliance are deliberately absent:
          // they are outside the margin, and folding them in here would make
          // the lines stop summing to it.
          otherPp: pp(enginePnl.otherOpex + enginePnl.financialLegs),
          // Signed, positive = credit.
          policyPp: pp(enginePnl.policyCredit),
        };
      }
      const util =
        Number.isFinite(sector.capitalStock) &&
        (sector.capitalStock as number) > 0 &&
        Number.isFinite(sector.producedUnits)
          ? Math.max(
              0,
              Math.min(1, (sector.producedUnits as number) / (sector.capitalStock as number))
            )
          : 1;
      const inputMult = getInputMultiplier(sector.productionPolicyLevel ?? 0);
      let inputsBill = 0;
      for (const [commodity, rate] of Object.entries(sectorEffectiveRates.demand) as [
        CommodityType,
        number,
      ][]) {
        if (!(rate > 0)) continue;
        inputsBill +=
          sectorRevenueLocal *
          rate *
          priceRealizationFactor(globalPriceRatioByCommodity.get(commodity)) *
          util *
          inputMult;
      }
      const inputsPp = Math.round((inputsBill / realized) * 1000) / 10;
      const laborPp =
        sectorLaborCostLocal != null && sectorLaborCostLocal > 0
          ? Math.round((sectorLaborCostLocal / realized) * 1000) / 10
          : null;
      const otherPp =
        Math.round((100 - effectiveProfitMargin - inputsPp - (laborPp ?? 0)) * 10) / 10;
      return { inputsPp, laborPp, otherPp, policyPp: 0 };
    })();
    // Local-cell share only: this query scopes to the corp's own buckets, so a
    // correct NATIONAL share (which the turn charges the burden on — see
    // buildNationalDominanceShareBySectorId) isn't available here without a
    // country-wide query. Displayed burden is a lower bound for a spread champion.
    const regulatoryBurdenRate = getDominanceRegulatoryBurden(sectorMarketSharePct);
    const sectorRegulatoryBurden = financialRevenue * regulatoryBurdenRate;
    totalRevenue += financialRevenue;
    totalMaintenanceCosts += maintenance;
    if (labourWagesEnabled && sectorLaborCostLocal != null && sectorLaborCostLocal > 0) {
      totalLaborCosts += sectorLaborCostLocal;
      // Same wage bill in ₳ on the per-turn clock the pension pass charges on,
      // keyed by sector so a collective agreement can pick out just the sectors
      // it covers.
      wageBillAnchorPerTurnBySectorId.set(
        sector._id.toString(),
        sectorFieldToAnchor(sector.laborCost as number, sector) / TURNS_PER_DAY
      );
    }
    totalGrowthCosts += sectorGrowthCostLocal;
    totalRegulatoryBurden += sectorRegulatoryBurden;
    totalSubsidyBenefit += financialRevenue * (subsidyMod / 100);

    // ── Plants-tier physicals ────────────────────────────────────────────
    // `capitalStock`, `producedUnits` and `soldUnits` share one basis: output
    // units on the same DAILY clock as `revenue` (under plants the stored
    // nameplate revenue IS `capitalStock × mixPrice`). So no rescaling here —
    // rescaling is exactly how the two clocks got mixed up before.
    const capacityUnits =
      plantsMode && Number.isFinite(sector.capitalStock) ? (sector.capitalStock as number) : null;
    const plantCount =
      plantsMode && Number.isInteger(sector.plantCount) && (sector.plantCount ?? 0) >= 0
        ? (sector.plantCount as number)
        : plantsMode
          ? seedPlantLedger(sector.sectorType, sector.capitalStock).plantCount
          : null;
    const producedUnits =
      plantsMode && Number.isFinite(sector.producedUnits) ? (sector.producedUnits as number) : null;
    const soldUnits =
      plantsMode && Number.isFinite(sector.soldUnits) ? (sector.soldUnits as number) : null;
    const constructionInProgressAnchor =
      plantsMode && Number.isFinite(sector.constructionInProgressAnchor)
        ? (sector.constructionInProgressAnchor as number)
        : null;
    const buildQueueSummary = plantsMode
      ? summarizeBuildQueue(sector.buildQueue, currentTurn)
      : null;
    const sectorFillRate = computeFillRate(producedUnits, soldUnits);
    // Share of the fill shortfall that is a DELIVERY failure, not a demand
    // failure. The row shows one fill number and a player reads every point of
    // missing fill as "nobody wanted it", which is the opposite instruction
    // from what a freight-limited sector needs. Null outside plants and when
    // the freight pass has written nothing.
    const deliveryLimitedFraction =
      plantsMode && Number.isFinite(sector.deliveryLimitedFraction)
        ? Math.max(0, Math.min(1, sector.deliveryLimitedFraction as number))
        : null;
    const deliveryLimitedFreightClass =
      plantsMode &&
      (sector.deliveryLimitedFreightClass === "bulk" ||
        sector.deliveryLimitedFreightClass === "special" ||
        sector.deliveryLimitedFreightClass === "grid")
        ? sector.deliveryLimitedFreightClass
        : null;
    const mothballed = plantsMode ? sector.mothballed === true : false;
    // Fill-adjusted margin (ticket #1027 family): realized profit over the full
    // cost bill, not over sold revenue. `effectiveProfitMargin` divides by the
    // revenue the SOLD units earned, so a plants sector selling 15% of its
    // output displays a fat positive margin while it loses money. Profit here
    // already nets the whole bill, so profit / cost is the honest ratio and it
    // reconciles with the profit figure shown on the same row. Plants only:
    // below plants there is no produced-vs-sold split for the margin to lie
    // about. Presentation only, never read back into the economy.
    const sectorTotalCost = maintenance + sectorGrowthCostLocal;
    const fillAdjustedMarginPct =
      plantsMode && sectorTotalCost > 0 ? Math.round((profit / sectorTotalCost) * 1000) / 10 : null;

    if (plantsMode) {
      totalCapacityUnits += capacityUnits ?? 0;
      totalProducedUnits += producedUnits ?? 0;
      totalSoldUnits += soldUnits ?? 0;
      totalConstructionInProgressAnchor += constructionInProgressAnchor ?? 0;
      if (mothballed) mothballedSectorCount += 1;
      if (buildQueueSummary) {
        buildingSectorCount += 1;
        totalUnitsOnOrder += buildQueueSummary.unitsOrdered;
      }
    }

    return {
      _id: sector._id,
      stateId: sector.stateId,
      countryId: sector.countryId,
      stateName: stateNameMap.get(sector.stateId) ?? sector.stateId,
      sectorType: sector.sectorType,
      sectorLabel: CORPORATION_TYPE_LABELS[sector.sectorType as CorporationType],
      displayName: sector.displayName ?? null,
      targetGrowthRate:
        sector.targetGrowthRate ?? sector.currentGrowthRate ?? sector.growthRate ?? 0,
      currentGrowthRate: sector.currentGrowthRate ?? sector.growthRate ?? 0,
      currentGrowthCost: Math.round(sectorGrowthCostLocal),
      revenue: Math.round(sectorRevenueLocal),
      // Suspended by a total embargo the operating country has against this
      // corp's nation — surfaced so the $0 reads as a suspension, not a bug.
      embargoSuspended: sector.embargoSuspended ?? false,
      financialRevenue: Math.round(financialRevenue),
      // Exact realized revenue when persisted (null on not-yet-reprocessed
      // sectors, where financialRevenue used the blended-ratio fallback).
      realizedRevenue:
        sectorRealizedRevenueLocal != null ? Math.round(sectorRealizedRevenueLocal) : null,
      profitMargin: sector.profitMargin,
      effectiveProfitMargin,
      // "physical": effectiveProfitMargin is the engine's derived margin and
      // `physicalCosts` explains it; "additive": legacy stack recompute.
      marginBasis: physicalCosts != null ? ("physical" as const) : ("additive" as const),
      physicalCosts,
      fillAdjustedMarginPct,
      techMarginBonus: techMarginBonus !== 0 ? techMarginBonus : null,
      marketSharePercent: sectorMarketSharePct,
      ...mods,
      commoditySupplyDemandBlendPct,
      profit: Math.round(profit),
      workers:
        sector.workers ??
        calculateWorkers(sectorFieldToAnchor(sector.revenue, sector), metrics.workforceSkill),
      workersDesired:
        sector.workersDesired ??
        calculateWorkers(sectorFieldToAnchor(sector.revenue, sector), metrics.workforceSkill),
      labourStaffingFactor: sector.labourStaffingFactor ?? 1,
      strategyId: sector.strategyId ?? "standard",
      stateResources: stateResourceCapacityByState.has(sector.stateId)
        ? (stateResourceCapacityByState.get(sector.stateId) ?? null)
        : undefined,
      transitionFromStrategyId: sector.transitionFromStrategyId ?? null,
      transitionStartTurn: sector.transitionStartTurn ?? null,
      transitionCooldownUntilTurn: sector.transitionCooldownUntilTurn ?? null,
      isReversing: sector.isReversing ?? false,
      productionPolicy: sector.productionPolicy ?? 0,
      productionPolicyLevel: sector.productionPolicyLevel ?? 0,
      forSale: sector.forSale
        ? {
            listedAt: sector.forSale.listedAt,
            priceAnchor: sector.forSale.priceAnchor,
            npvAnchor: sector.forSale.npvAnchor,
          }
        : null,
      // Plants-tier physicals. Null outside plants — never removed, so a
      // capital-tier client keeps reading exactly the fields it always did.
      capacityUnits,
      plantCount,
      producedUnits,
      soldUnits,
      // Exact ratio. The API layer replaces this with null (and keeps only the
      // band) for a viewer without insider access — see financialFogOfWar.
      fillRate: sectorFillRate,
      fillRateBand: fillRateBand(sectorFillRate),
      deliveryLimitedFraction,
      deliveryLimitedFreightClass,
      mothballed,
      buildQueueSummary,
      constructionInProgressAnchor,
    };
  });

  const ceoSalary = corporation.ceoSalary ?? 0;
  const [outstandingBonds, heldBondsRaw] = await Promise.all([
    db.collection<Bond>("bonds").find({ corporationId: corporation._id, matured: false }).toArray(),
    db
      .collection<Bond>("bonds")
      .find({ "holders.corporationId": corporation._id, matured: false })
      .toArray(),
  ]);

  const heldBondIssuerCorpIds = [
    ...new Set(heldBondsRaw.filter((b) => b.corporationId).map((b) => b.corporationId.toString())),
  ];
  const heldBondIssuerCorps =
    heldBondIssuerCorpIds.length > 0
      ? await db
          .collection<Corporation>("corporations")
          .find(
            { _id: { $in: heldBondIssuerCorpIds.map((id) => new ObjectId(id)) } },
            { projection: { _id: 1, name: 1 } }
          )
          .toArray()
      : [];
  const heldBondIssuerMap = new Map(heldBondIssuerCorps.map((c) => [c._id.toString(), c.name]));

  const GAME_DAYS_PER_YEAR_RATIO = TURNS_PER_YEAR / TURNS_PER_DAY;
  const portfolioFxByCurrency = await loadValuationFxRates(db);
  const heldBondsSummary = heldBondsRaw.map((bond) => {
    const holding = bond.holders.find(
      (h) => h.corporationId?.toString() === corporation._id.toString()
    );
    const units = holding?.units ?? 0;
    const couponPerUnit = perTurnCouponPayment(bond.couponRate, BOND_UNIT_FACE_VALUE);
    const dailyIncome = couponPerUnit * units * TURNS_PER_DAY;
    const currentValue = units * BOND_UNIT_FACE_VALUE * bond.marketPrice;
    const bondCcy = (bond.currencyCode ??
      (bond.countryId && bond.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[bond.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondRate = bondCcy ? (portfolioFxByCurrency.get(bondCcy) ?? 1) : 1;
    const currentValueAnchor = bondCcy && bondRate > 0 ? currentValue / bondRate : currentValue;
    const dailyIncomeAnchor = bondCcy && bondRate > 0 ? dailyIncome / bondRate : dailyIncome;
    const issuerName = getBondIssuerDisplayName(
      bond,
      heldBondIssuerMap.get(bond.corporationId?.toString() ?? "")
    );

    return {
      bondId: bond._id.toString(),
      issuerName,
      currencyCode: bondCcy,
      units,
      couponRate: bond.couponRate,
      marketPrice: bond.marketPrice,
      turnsRemaining: Math.max(0, bond.maturityTurn - currentTurn),
      currentValue: Math.round(currentValue),
      currentValueAnchor,
      dailyIncome: Math.round(dailyIncome),
      dailyIncomeAnchor,
    };
  });

  const totalBondHoldingsValue = heldBondsSummary.reduce((sum, b) => sum + b.currentValueAnchor, 0);
  const dailyCouponIncome = heldBondsSummary.reduce((sum, b) => sum + b.dailyIncomeAnchor, 0);

  const heldCorps = await db
    .collection<Corporation>("corporations")
    .find({ "shareholders.corporationId": corporation._id })
    .project({ _id: 1, sharePrice: 1, shareholders: 1, countryId: 1 })
    .toArray();

  let totalStockHoldingsValue = 0;
  for (const heldCorp of heldCorps) {
    const entry = heldCorp.shareholders?.find(
      (sh: Shareholder) => sh.corporationId?.toString() === corporation._id.toString()
    );
    if (entry && entry.shares > 0) {
      const sharePrice = getPublicShareQuote(heldCorp);
      const stockValueLocal = entry.shares * sharePrice;
      const heldFxRate = fxRateForCorpFromMap(heldCorp, portfolioFxByCurrency);
      totalStockHoldingsValue += corpLiquidCapitalToAnchor(stockValueLocal, heldCorp, heldFxRate);
    }
  }

  const { receivables: imfReceivableRows, totalPrincipal: imfReceivablesPrincipal } =
    await findImfFacilityReceivablesForLender(db, corporation._id);
  const [latestCorpIncomeRow, imfLenderReceiptsAnchor] = await Promise.all([
    db
      .collection<{
        income?: number;
        turn?: number;
        dividendIncomeReceived?: number;
        perTurnBondCouponIncome?: number;
        perTurnBondDragOnNetIncome?: number;
        dividendPaidPerTurn?: number;
      }>("corporationHistory")
      .findOne(
        { corporationId: corporation._id },
        {
          sort: { turn: -1 },
          projection: {
            income: 1,
            turn: 1,
            dividendIncomeReceived: 1,
            perTurnBondCouponIncome: 1,
            perTurnBondDragOnNetIncome: 1,
            dividendPaidPerTurn: 1,
          },
        }
      ),
    imfReceivableRows.length > 0
      ? sumImfLenderReceiptsAnchorPerTurnForReceivables(db, imfReceivableRows)
      : Promise.resolve(0),
  ]);
  const turnIncomeForImf =
    typeof latestCorpIncomeRow?.income === "number" ? latestCorpIncomeRow.income : 0;
  // Realized dividend income (local ccy) this corp received from holdings last
  // turn, scaled per-turn → daily to match the projected `income` units (#3109).
  // Reporting only — the cash was already credited in the dividend phase.
  const dividendIncomeReceivedDaily =
    typeof latestCorpIncomeRow?.dividendIncomeReceived === "number"
      ? Math.round(latestCorpIncomeRow.dividendIncomeReceived * TURNS_PER_DAY)
      : 0;
  const imfFacilityPaymentDaily =
    corporation.imfBailoutActive === true
      ? Math.round(
          anchorPerTurnToFinancialDaily(
            imfFacilityPaymentAnchorPerTurn(corporation, turnIncomeForImf)
          )
        )
      : 0;
  const imfFacilityReceiptsDaily =
    imfReceivableRows.length > 0
      ? Math.round(anchorPerTurnToFinancialDaily(imfLenderReceiptsAnchor))
      : 0;

  const totalDebtAnchor = outstandingBonds.reduce((sum, b) => {
    const bondCcy = (b.currencyCode ??
      (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    return sum + corpCapitalToAnchor(b.totalIssued, bondCcy, bondFxRate);
  }, 0);
  const annualInterestAnchor = outstandingBonds.reduce((sum, b) => {
    const bondCcy = (b.currencyCode ??
      (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
        ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
        : undefined)) as CurrencyCode | undefined;
    const bondFxRate = bondCcy ? (fxByCurrency.get(bondCcy) ?? 1) : 1;
    return sum + corpCapitalToAnchor((b.couponRate / 100) * b.totalIssued, bondCcy, bondFxRate);
  }, 0);
  const dailyInterestAnchor = annualInterestAnchor / GAME_DAYS_PER_YEAR_RATIO;

  const logisticsBudget = corporation.logisticsBudget ?? 0;
  const rdBudget = corporation.rdBudget ?? 0;

  // Occupational pensions. The pension pass debits liquidCapital twice a turn
  // under a collective agreement and both legs only ever showed up in the
  // financial transaction log, which no player surface reads, so a CEO watched
  // cash fall with nothing on the statement to name it. Two lines, not one: the
  // bargained contribution is a price the CEO agreed, the deficit top-up is a
  // consequence the CEO did not.
  const pensionCostPerTurn = labourWagesEnabled
    ? await employerPensionCostForTurn(
        db,
        corporation._id,
        currentTurn,
        wageBillAnchorPerTurnBySectorId
      )
    : EMPTY_EMPLOYER_PENSION_COST;
  const pensionContributionCost = anchorToCorpCapital(
    anchorPerTurnToFinancialDaily(pensionCostPerTurn.contributionAnchorPerTurn),
    pageCorpCcy,
    pageCorpRate
  );
  const pensionTopUpCost = anchorToCorpCapital(
    anchorPerTurnToFinancialDaily(pensionCostPerTurn.topUpAnchorPerTurn),
    pageCorpCcy,
    pageCorpRate
  );

  const operatingCosts =
    totalMaintenanceCosts +
    totalGrowthCosts +
    totalRegulatoryBurden +
    corporation.marketingBudget +
    logisticsBudget +
    rdBudget +
    ceoSalary +
    pensionContributionCost +
    pensionTopUpCost;
  const operatingIncome = totalRevenue - operatingCosts;

  const domesticFederalRateByCountry = new Map<string, number>();
  const foreignFederalRateByCountry = new Map<string, number>();
  for (const fb of federalBudgets) {
    if (!fb.countryId) continue;
    const dom = fb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticFederalRateByCountry.set(fb.countryId, dom);
    const fgn = fb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignFederalRateByCountry.set(fb.countryId, fgn);
  }
  const domesticStateRateByStateId = new Map<string, number>();
  const foreignStateRateByStateId = new Map<string, number>();
  for (const sb of stateBudgetsForTax) {
    const dom = sb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticStateRateByStateId.set(sb._id, dom);
    const fgn = sb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignStateRateByStateId.set(sb._id, fgn);
  }

  const sectorOperatingTotal = sectorDetails.reduce((sum, s) => sum + (s.profit ?? 0), 0);
  const corpLevelCosts = sectorOperatingTotal - operatingIncome;
  const sectorRevenueTotal = sectorDetails.reduce(
    (sum, s) => sum + (s.financialRevenue ?? s.revenue ?? 0),
    0
  );
  const corpLegalStructure = getLegalStructureForCorp(corporation);
  const corpTaxMultiplier =
    corpLegalStructure.taxTreatment === "pass_through"
      ? 0
      : corpLegalStructure.taxTreatment === "preferential"
        ? (corpLegalStructure.taxMultiplier ?? 1)
        : 1;

  let displayFederalTax = 0;
  let displayStateTax = 0;
  const federalTaxByCountry: Record<string, number> = {};
  const perSectorTax = new Map<
    string,
    { federalTaxPaid: number; stateTaxPaid: number; federalTaxRate: number; stateTaxRate: number }
  >();
  for (const sd of sectorDetails) {
    const revenueShare =
      sectorRevenueTotal > 0 ? (sd.financialRevenue ?? sd.revenue ?? 0) / sectorRevenueTotal : 0;
    const sectorNetIncome = (sd.profit ?? 0) - corpLevelCosts * revenueShare;
    const sectorTaxable = Math.max(0, sectorNetIncome);
    const sectorCountry = sd.countryId ?? corporation.countryId;
    const isDomestic = corporation.countryId === sectorCountry;
    const federalRate =
      corpTaxMultiplier *
      (isDomestic
        ? (domesticFederalRateByCountry.get(sectorCountry) ?? 0)
        : (foreignFederalRateByCountry.get(sectorCountry) ?? 0));
    const stateRate =
      corpTaxMultiplier *
      (isDomestic
        ? (domesticStateRateByStateId.get(sd.stateId) ?? 0)
        : (foreignStateRateByStateId.get(sd.stateId) ?? 0));
    const fedTax = Math.round(sectorTaxable * (federalRate / 100));
    const stTax = Math.round(sectorTaxable * (stateRate / 100));
    displayFederalTax += fedTax;
    displayStateTax += stTax;
    federalTaxByCountry[sectorCountry] = (federalTaxByCountry[sectorCountry] ?? 0) + fedTax;
    perSectorTax.set(sd._id.toString(), {
      federalTaxPaid: fedTax,
      stateTaxPaid: stTax,
      federalTaxRate: federalRate,
      stateTaxRate: stateRate,
    });
  }

  const corpCurrency = resolveCorpLiquidCurrencyCode(corporation);
  const corpFxRate = fxRateForCorpFromMap(corporation, fxByCurrency);
  const dailyInterestLocal = anchorToCorpCapital(dailyInterestAnchor, corpCurrency, corpFxRate);
  const dailyCouponIncomeLocal = anchorToCorpCapital(dailyCouponIncome, corpCurrency, corpFxRate);

  const corpHomeCountryFedRate = domesticFederalRateByCountry.get(corporation.countryId) ?? 0;
  const bondCouponFedTaxLocal = Math.round(
    Math.max(0, dailyCouponIncomeLocal) * corpTaxMultiplier * (corpHomeCountryFedRate / 100)
  );
  if (bondCouponFedTaxLocal > 0) {
    displayFederalTax += bondCouponFedTaxLocal;
    federalTaxByCountry[corporation.countryId] =
      (federalTaxByCountry[corporation.countryId] ?? 0) + bondCouponFedTaxLocal;
  }
  const corporateTax = displayFederalTax + displayStateTax;
  const imfFacilityPaymentDailyLocal = anchorToCorpCapital(
    imfFacilityPaymentDaily,
    corpCurrency,
    corpFxRate
  );
  const imfFacilityReceiptsDailyLocal = anchorToCorpCapital(
    imfFacilityReceiptsDaily,
    corpCurrency,
    corpFxRate
  );
  const totalDebtLocal = anchorToCorpCapital(totalDebtAnchor, corpCurrency, corpFxRate);
  const totalCostsLocal = operatingCosts + dailyInterestLocal;
  const isNatcorp = !!corporation.countryOwnerId;
  const governmentBondSubsidyLocal = isNatcorp ? dailyInterestLocal : 0;
  const income =
    operatingIncome -
    corporateTax +
    dailyCouponIncomeLocal -
    dailyInterestLocal +
    governmentBondSubsidyLocal -
    imfFacilityPaymentDailyLocal +
    imfFacilityReceiptsDailyLocal +
    dividendIncomeReceivedDaily;

  const currentLogisticsStrength = corporation.logisticsStrength ?? 0;
  const currentRdScore = corporation.rdScore ?? 0;
  const { marketingStrengthGrowth, logisticsStrengthNetChange, rdScoreNetChange } =
    calculateCorpStrengthProjection(
      {
        marketingBudget: corporation.marketingBudget,
        marketingStrength: corporation.marketingStrength ?? 0,
        logisticsBudget,
        logisticsStrength: currentLogisticsStrength,
        rdBudget: corporation.rdBudget ?? 0,
        rdScore: currentRdScore,
        liquidCurrencyCode: corpCurrency,
      },
      corpFxRate
    );

  const totalShares = corporation.totalShares ?? 10_000_000;
  const marketCapitalization = getRoundedPublicMarketCap(corporation, totalShares);
  const GAME_DAYS_PER_YEAR = TURNS_PER_YEAR / TURNS_PER_DAY;
  const sectorNPVs = sectorDetails.map((sector) => {
    const yearlyProfit = sector.profit * GAME_DAYS_PER_YEAR;
    const npv = yearlyProfit > 0 ? Math.round(yearlyProfit / NPV_ANNUAL_DISCOUNT_RATE) : 0;
    return {
      sectorId: sector._id,
      stateId: sector.stateId,
      stateName: sector.stateName,
      sectorType: sector.sectorType,
      dailyProfit: sector.profit,
      effectiveProfitMargin: sector.effectiveProfitMargin,
      npv,
    };
  });
  const totalSectorNPV = sectorNPVs.reduce((sum, s) => sum + s.npv, 0);
  const currentSharePrice = Math.round((corporation.sharePrice ?? MIN_SHARE_PRICE) * 100) / 100;
  const totalPortfolioAnchor =
    totalStockHoldingsValue + totalBondHoldingsValue + imfReceivablesPrincipal;
  const totalPortfolioValue = anchorToCorpCapital(totalPortfolioAnchor, corpCurrency, corpFxRate);
  const techAssetValueLocal = anchorToCorpCapital(
    computeTechAssetValueAnchor(corporation, gameState?.currentYear),
    corpCurrency,
    corpFxRate
  );
  const totalAssets =
    corporation.liquidCapital + totalSectorNPV + totalPortfolioValue + techAssetValueLocal;
  const bookValue = totalAssets - totalDebtLocal;
  const bondHoldingsValueLocal = anchorToCorpCapital(
    totalBondHoldingsValue,
    corpCurrency,
    corpFxRate
  );
  const stockHoldingsValueLocal = anchorToCorpCapital(
    totalStockHoldingsValue,
    corpCurrency,
    corpFxRate
  );
  const imfReceivablesPrincipalLocal = anchorToCorpCapital(
    imfReceivablesPrincipal,
    corpCurrency,
    corpFxRate
  );

  const balanceSheet = {
    assets: {
      cashOnHand: Math.round(corporation.liquidCapital),
      sectorNPVs,
      totalSectorNPV,
      bondHoldingsValue: Math.round(bondHoldingsValueLocal),
      stockHoldingsValue: Math.round(stockHoldingsValueLocal),
      imfFacilityReceivablesValue: Math.round(imfReceivablesPrincipalLocal),
      imfFacilityReceivables: imfReceivableRows.map((r) => ({
        borrowerCorporationId: r.borrowerCorporationId,
        borrowerName: r.borrowerName,
        sequentialId: r.sequentialId,
        principalOutstanding: Math.round(
          anchorToCorpCapital(r.principalOutstanding, corpCurrency, corpFxRate)
        ),
      })),
      totalPortfolioValue: Math.round(totalPortfolioValue),
      heldBonds: heldBondsSummary,
      techAssetValue: Math.round(techAssetValueLocal),
      totalAssets: Math.round(totalAssets),
    },
    liabilities: {
      dailyCosts: Math.round(operatingCosts),
      totalDebt: Math.round(totalDebtLocal),
      dailyInterestCost: Math.round(dailyInterestLocal),
      bondCount: outstandingBonds.length,
    },
    equity: {
      totalEquity:
        corporation.liquidCapital +
        totalSectorNPV +
        Math.round(totalPortfolioValue) +
        Math.round(techAssetValueLocal) -
        (corporation.countryOwnerId ? 0 : Math.round(totalDebtLocal)),
      bookValue: Math.round(bookValue),
      marketCapitalization: Math.round(marketCapitalization),
    },
  };

  const controllingParent = getControllingCorporateParent(corporationForControl);
  // The parent-corp lookup, the subsidiary-candidates query, and the hostile-
  // takeover eligibility build are independent — fan them out in one round
  // trip instead of three sequential awaits.
  const [pDoc, subsidiaryCandidates, hostileTakeoverEligibility, reservedPlacedByThisCorp] =
    await Promise.all([
      controllingParent
        ? db
            .collection<Corporation>("corporations")
            .findOne(
              { _id: controllingParent.corporationId },
              { projection: { _id: 1, name: 1, sequentialId: 1 } }
            )
        : Promise.resolve(null),
      db
        .collection<Corporation>("corporations")
        .find({
          shareholders: {
            $elemMatch: {
              corporationId: corporation._id,
              shares: { $gt: 0 },
            },
          },
        })
        // superShareMultiplier is required: control is voting power, and a
        // dual-class corp's voting total differs from its share total.
        .project<
          Pick<
            Corporation,
            | "_id"
            | "name"
            | "sequentialId"
            | "totalShares"
            | "shareholders"
            | "superShareMultiplier"
          >
        >({
          _id: 1,
          name: 1,
          sequentialId: 1,
          totalShares: 1,
          shareholders: 1,
          superShareMultiplier: 1,
        })
        .toArray(),
      buildHostileTakeoverEligibility(db, corporation, viewerUserId),
      loadReservedPositionsPlacedBy(db, corporation._id),
    ]);

  let parentCorporationPayload: {
    _id: string;
    sequentialId?: number;
    name: string;
    ownershipPct: number;
  } | null = null;
  if (controllingParent && pDoc) {
    parentCorporationPayload = {
      _id: pDoc._id.toString(),
      sequentialId: pDoc.sequentialId,
      name: pDoc.name,
      ownershipPct: controllingParent.ownershipPct,
    };
  }

  const subsidiariesPayload: Array<{
    _id: string;
    sequentialId?: number;
    name: string;
    ownershipPct: number;
  }> = [];
  const reservedSharesByTarget = new Map(
    reservedPlacedByThisCorp.map((r) => [r.targetCorpId.toString(), r.shares])
  );
  const candidateIds = new Set(subsidiaryCandidates.map((s) => s._id.toString()));
  const missingReservedIds = reservedPlacedByThisCorp
    .map((r) => r.targetCorpId)
    .filter((id) => !candidateIds.has(id.toString()));
  if (missingReservedIds.length > 0) {
    const extraSubs = await db
      .collection<Corporation>("corporations")
      .find({ _id: { $in: missingReservedIds } })
      .project<
        Pick<
          Corporation,
          "_id" | "name" | "sequentialId" | "totalShares" | "shareholders" | "superShareMultiplier"
        >
      >({
        _id: 1,
        name: 1,
        sequentialId: 1,
        totalShares: 1,
        shareholders: 1,
        superShareMultiplier: 1,
      })
      .toArray();
    subsidiaryCandidates.push(...extraSubs);
  }
  for (const sub of subsidiaryCandidates) {
    const reservedShares = reservedSharesByTarget.get(sub._id.toString()) ?? 0;
    const subForControl = corporationWithReservedHoldings(sub as Corporation, [
      { corporationId: corporation._id, shares: reservedShares },
    ]);
    const total = subForControl.totalShares ?? 0;
    if (total <= 0) continue;
    // Control is VOTING power everywhere else in the subsidiary model
    // (getControllingCorporateParent, the formalize guard, the hostile
    // threshold). Listing by raw share percent made a dual-class corp appear
    // in, or vanish from, the parent's subsidiary list while the actions on it
    // disagreed. Same helper the takeover path uses.
    const pct = acquirerOwnershipPercent(corporation._id, subForControl);
    if (pct > SUBSIDIARY_OWNERSHIP_THRESHOLD_PERCENT) {
      subsidiariesPayload.push({
        _id: sub._id.toString(),
        sequentialId: sub.sequentialId,
        name: sub.name,
        ownershipPct: Math.round(pct * 100) / 100,
      });
    }
  }

  // Subsidiary corporations (feature-gated): derive management/formalization
  // eligibility for the viewer + honor the parent dividend floor. Read the flag
  // via the in-scope db (this query already holds a connection).
  const subsidiaryGs = await db
    .collection<{ _id: string; subsidiaryCorporationsEnabled?: boolean }>("gameState")
    .findOne({ _id: "current" }, { projection: { subsidiaryCorporationsEnabled: 1 } });
  const subsidiaryCorporationsEnabled = subsidiaryGs?.subsidiaryCorporationsEnabled === true;
  const isFormalizedSub = isFormalizedSubsidiaryHelper(corporation, controllingParent);
  const activeFloorPct = activeParentDividendFloorPct({
    enabled: subsidiaryCorporationsEnabled,
    parentDividendFloorPct: corporation.parentDividendFloorPct,
    parentDividendFloorSetByCorpId: corporation.parentDividendFloorSetByCorpId,
    controllingParent,
    maxRate: MAX_DIVIDEND_RATE,
  });
  let canManageAsParent = false;
  let canFormalizeAsSubsidiary = false;
  // Viewer (as CEO of this corp) may spin off a subsidiary when the corp is
  // eligible to act as a parent. The command re-checks cooldown + sector count.
  const canSpinOff =
    subsidiaryCorporationsEnabled &&
    !!viewerUserId &&
    corporation.ceoVacant !== true &&
    corporation.userId?.toString() === viewerUserId &&
    isEligibleAsSubsidiaryParent(corporation);
  if (subsidiaryCorporationsEnabled && viewerUserId) {
    canManageAsParent = await canActOnCorporationAsParent(
      db,
      new ObjectId(viewerUserId),
      corporation
    );
    // Viewer may formalize iff they are CEO of the corp controlling >50% of this
    // target, both corps are eligible, and it is not already formalized. Cycle
    // safety is enforced authoritatively by the formalize command.
    if (
      !isFormalizedSub &&
      controllingParent != null &&
      pDoc != null &&
      isEligibleAsSubsidiary(corporation) &&
      corporation.subsidiaryFormalizedAtTurn == null
    ) {
      const parentDoc = await db.collection<Corporation>("corporations").findOne(
        { _id: controllingParent.corporationId },
        {
          projection: {
            userId: 1,
            ceoVacant: 1,
            countryOwnerId: 1,
            subsidiaryFormalizedAtTurn: 1,
          },
        }
      );
      canFormalizeAsSubsidiary =
        parentDoc != null &&
        parentDoc.ceoVacant !== true &&
        parentDoc.userId?.toString() === viewerUserId &&
        isEligibleAsSubsidiaryParent(parentDoc);
    }
  }

  // Mirror the turn-loop dividend payout rule (sectorCalculations.ts dividend
  // block): effective rate is max(corp.dividendRate clamped, legalStructure
  // floor × 100, active parent dividend floor), and pool is capped by income.
  const corpDividendRateClamped = Math.min(corporation.dividendRate ?? 0, MAX_DIVIDEND_RATE);
  const legalMinDividendPct = (corpLegalStructure.minimumDividendRate ?? 0) * 100;
  const effectiveDividendRate =
    income > 0 ? Math.max(corpDividendRateClamped, legalMinDividendPct, activeFloorPct) : 0;
  const dividendDistribution =
    effectiveDividendRate > 0 && income > 0
      ? Math.min(income * (effectiveDividendRate / 100), income)
      : 0;

  const financials = {
    totalRevenue: Math.round(totalRevenue),
    // Maintenance shown net of labour; the wage slice is broken out as `laborCosts`.
    // Under plants this residual CAN be negative: derived operating cost already
    // includes labour, and a negative other-opex residual is a real credit that
    // Gross Profit must keep (clamping it double-counts wages; ticket #1122 is
    // a display bug, not a sign error). The Cost of Revenue renderer formats a
    // credit without wrapping a minus inside parentheses.
    maintenanceCosts: Math.round(totalMaintenanceCosts - totalLaborCosts),
    laborCosts: Math.round(totalLaborCosts),
    growthCosts: Math.round(totalGrowthCosts),
    regulatoryBurden: Math.round(totalRegulatoryBurden),
    marketingCosts: corporation.marketingBudget,
    logisticsCosts: logisticsBudget,
    rdCosts: rdBudget,
    ceoSalaryCost: ceoSalary,
    pensionContributionCost: Math.round(pensionContributionCost),
    pensionTopUpCost: Math.round(pensionTopUpCost),
    pensionSchemesInDeficit: pensionCostPerTurn.schemesInDeficit,
    operatingCosts: Math.round(operatingCosts),
    operatingIncome: Math.round(operatingIncome),
    federalTax: displayFederalTax,
    stateTax: displayStateTax,
    federalTaxByCountry,
    bondInterestCost: Math.round(dailyInterestLocal),
    bondCouponIncome: Math.round(dailyCouponIncomeLocal),
    dividendIncomeReceived: dividendIncomeReceivedDaily,
    governmentBondSubsidy: Math.round(governmentBondSubsidyLocal),
    imfFacilityPaymentDaily: Math.round(imfFacilityPaymentDailyLocal),
    imfFacilityReceiptsDaily: Math.round(imfFacilityReceiptsDailyLocal),
    totalCosts: Math.round(totalCostsLocal),
    income: Math.round(income),
    // Ground-truth realized net income from the engine's last snapshot, converted
    // from per-turn to the daily display units the projected `income` uses. This
    // is what actually hit liquidCapital last turn — it reflects embargo/tariff/
    // clearing haircuts the projection above can't fully reproduce (ticket #935).
    ...(typeof latestCorpIncomeRow?.income === "number"
      ? {
          // Matches the Financials headline (operating + bond coupons −
          // bond interest + dividends received): history.income is
          // operating-only, so a bond/holding-portfolio corp's masthead went
          // deeply negative while the income statement was positive (#941).
          realizedIncome: Math.round(
            (latestCorpIncomeRow.income +
              (latestCorpIncomeRow.perTurnBondCouponIncome ?? 0) -
              (latestCorpIncomeRow.perTurnBondDragOnNetIncome ?? 0) +
              (latestCorpIncomeRow.dividendIncomeReceived ?? 0)) *
              TURNS_PER_DAY
          ),
          // Dividends the engine ACTUALLY paid out of that same turn's income,
          // in the same daily display units. `realizedIncome` above is already
          // net of this (sectorCalculations.ts: `income = afterTaxOperating −
          // hourlyDividendPayout`), so surfaces must NOT subtract
          // `dividendDistribution` — the projection-derived estimate — from it
          // again. Exposing the realized payout lets them reconstruct the
          // pre-dividend headline instead (ticket #1098).
          realizedDividendPaid: Math.round(
            Math.max(0, latestCorpIncomeRow.dividendPaidPerTurn ?? 0) * TURNS_PER_DAY
          ),
          ...(typeof latestCorpIncomeRow.turn === "number"
            ? { realizedIncomeTurn: latestCorpIncomeRow.turn }
            : {}),
        }
      : {}),
    dividendRate: corporation.dividendRate ?? 0,
    effectiveDividendRate,
    dividendDistribution: Math.round(dividendDistribution),
    // Realized revenue growth under plants; below plants (or with too little
    // history to annualize honestly) the legacy sector average still applies.
    currentGrowthRate:
      realizedGrowthRate ??
      (sectors.length > 0
        ? sectors.reduce((sum, s) => sum + (s.currentGrowthRate ?? s.growthRate ?? 0), 0) /
          sectors.length
        : 0),
    /** True when `currentGrowthRate` is measured realized revenue, not the legacy field. */
    growthRateIsRealized: realizedGrowthRate !== null,
    subsidyBenefit: Math.round(totalSubsidyBenefit),
  };

  const shareholders = (() => {
    type ShareholderResponse = {
      characterId?: string;
      corporationId?: string;
      shares: number;
      name: string;
      sequentialId?: number;
      avatarUrl?: string;
      logoUrl?: string;
      borderKey?: string | null;
      tintColor?: string | null;
      isImperial?: boolean;
      homeState?: string;
      countryId?: string;
      superShares?: number;
      isFund?: boolean;
      fundSlug?: string;
      fundScope?: IndexFund["scope"];
      fundCountryId?: string;
    };

    const existing: ShareholderResponse[] = (corporationForControl.shareholders ?? [])
      .filter(
        (sh) =>
          sh.characterId != null ||
          sh.imperialCharacterId != null ||
          sh.corporationId != null ||
          sh.nppId != null ||
          sh.fundId != null
      )
      .flatMap<ShareholderResponse>((sh) => {
        if (sh.corporationId != null) {
          const corpInfo = corporationShareholderNameMap.get(sh.corporationId.toString());
          if (!corpInfo) return [];
          return [
            {
              corporationId: sh.corporationId.toString(),
              shares: sh.shares,
              name: corpInfo.name,
              sequentialId: corpInfo.sequentialId,
              logoUrl: corpInfo.logoUrl,
            },
          ];
        }
        if (sh.nppId != null) {
          const nppInfo = nppShareholderNameMap.get(sh.nppId.toString());
          return [
            {
              characterId: sh.nppId.toString(),
              shares: sh.shares,
              name: nppInfo?.name ?? "NPP",
              isNpp: true,
            },
          ];
        }
        if (sh.fundId != null) {
          const fundInfo = fundShareholderNameMap.get(sh.fundId.toString());
          return [
            {
              characterId: sh.fundId.toString(),
              shares: sh.shares,
              name: fundInfo?.name ?? "Index Fund",
              isNpp: true,
              isFund: true,
              fundSlug: fundInfo?.slug,
              fundScope: fundInfo?.scope,
              fundCountryId: fundInfo?.countryId,
            },
          ];
        }
        const id = (sh.characterId ?? sh.imperialCharacterId)?.toString() ?? "";
        const info = shareholderNameMap.get(id);
        return [
          {
            characterId: id,
            shares: sh.shares,
            ...(sh.superShares ? { superShares: sh.superShares } : {}),
            name: info?.name ?? "Unknown",
            sequentialId: info?.sequentialId,
            avatarUrl: info?.avatarUrl,
            borderKey: info?.borderKey ?? null,
            tintColor: info?.tintColor ?? null,
            isImperial: info?.isImperial ?? false,
            homeState: info?.homeState,
            countryId: info?.countryId,
          },
        ];
      });

    const accountedShares = computeAccountedShares(
      corporation,
      openListingsForInvariant,
      openSellOrdersForInvariant
    );
    const unaccounted = totalShares - accountedShares;
    if (unaccounted > 0 && corporation.ceoId) {
      const ceoEntry = existing.find((sh) => sh.characterId === corporation.ceoId.toString());
      if (ceoEntry) {
        ceoEntry.shares += unaccounted;
      } else {
        const ceoBorder = ceo?.userId ? corpBorderMap.get(ceo.userId.toString()) : undefined;
        existing.push({
          characterId: corporation.ceoId.toString(),
          shares: unaccounted,
          name: ceo?.name ?? "Unknown",
          sequentialId: ceo?.sequentialId,
          avatarUrl: ceo?.avatarUrl,
          borderKey: ceoBorder?.borderKey ?? null,
          tintColor: ceoBorder?.tintColor ?? null,
          isImperial: isImperialCeo,
          homeState: ceo?.homeState as string | undefined,
          countryId: ceo?.countryId as string | undefined,
        });
      }
    }
    return existing;
  })();

  // Brand loyalty (Package A): the RAW 0–100 number and the corp's price-identity
  // norm are owner-only intel. Everyone else gets the hidden 5-label scale, never
  // the number. Absent ⇒ feature disabled for this corp; omit entirely so the UI
  // hides the indicator rather than showing a misleading 0.
  const viewerIsOwner =
    !!viewerUserId &&
    corporation.userId?.toString() === viewerUserId &&
    !corporation.countryOwnerId;
  const brandLoyaltyValue = corporation.brandLoyalty;
  const brandLoyaltyFields =
    brandLoyaltyValue != null
      ? {
          brandLoyaltyLabel: loyaltyLabel(brandLoyaltyValue),
          ...(viewerIsOwner
            ? {
                brandLoyalty: Math.round(brandLoyaltyValue * 10) / 10,
                brandPostureNorm: corporation.brandPostureNorm,
              }
            : {}),
        }
      : {};

  // Corp-level physical P&L rollup (plants only). One object rather than eight
  // loose keys so a client can test `physical != null` as its plants switch and
  // cannot end up half-reading it.
  const physical = plantsMode
    ? {
        capacityUnits: Math.round(totalCapacityUnits),
        producedUnits: Math.round(totalProducedUnits),
        soldUnits: Math.round(totalSoldUnits),
        // Corp-wide fill is Σsold ÷ Σproduced, NOT the mean of the per-sector
        // ratios: a mean lets one tiny plant running at 5% drag the headline
        // for a corporation that is selling everything it makes.
        fillRate: computeFillRate(totalProducedUnits, totalSoldUnits),
        constructionInProgressAnchor: Math.round(totalConstructionInProgressAnchor),
        unitsOnOrder: Math.round(totalUnitsOnOrder),
        buildingSectorCount,
        mothballedSectorCount,
        sectorCount: sectorDetails.length,
      }
    : null;

  return {
    corporation: {
      ...brandLoyaltyFields,
      /** True when this world runs `marketSystemMode >= "plants"`. */
      plantsMode,
      /** Corp-wide physical rollups; null outside plants. */
      physical,
      averageQuality:
        corporation.averageQuality != null
          ? Math.round(corporation.averageQuality * 10) / 10
          : undefined,
      ceoShareWindow,
      _id: corporation._id.toString(),
      sequentialId: corporation.sequentialId,
      name: corporation.name,
      tickerSymbol: corporation.tickerSymbol ?? undefined,
      description: corporation.description,
      type: corporation.type,
      countryId: corporation.countryId,
      secondaryType: corporation.secondaryType ?? null,
      typeSwitchCooldownUntilTurn: corporation.typeSwitchCooldownUntilTurn ?? null,
      typeSwitchTurn: corporation.typeSwitchTurn ?? null,
      currentTurn,
      typeLabel: CORPORATION_TYPE_LABELS[corporation.type],
      headquartersState: corporation.headquartersState,
      headquartersStateName:
        stateNameMap.get(corporation.headquartersState) ?? corporation.headquartersState,
      liquidCapital: Math.round(corporation.liquidCapital),
      liquidCurrencyCode:
        corporation.liquidCurrencyCode ??
        COUNTRY_CURRENCY_MAP[corporation.countryId as CountryId] ??
        "USD",
      recentNetIncome: Math.round(income),
      marketingBudget: corporation.marketingBudget,
      ceoSalary,
      brandColor: corporation.brandColor,
      marketingStrength: roundMarketingStrength(corporation.marketingStrength),
      marketingStrengthGrowth: Math.round(marketingStrengthGrowth * 1000) / 1000,
      logisticsBudget,
      logisticsStrength: currentLogisticsStrength,
      logisticsStrengthNetChange: Math.round(logisticsStrengthNetChange * 1000) / 1000,
      rdBudget: corporation.rdBudget ?? 0,
      rdScore: Math.round(currentRdScore * 1000) / 1000,
      rdScoreNetChange: Math.round(rdScoreNetChange * 1000) / 1000,
      marketCapitalization: Math.round(marketCapitalization),
      logoUrl: corporation.logoUrl,
      headerImageUrl: corporation.headerImageUrl,
      sharePrice: currentSharePrice,
      totalShares,
      publicFloat: corporation.publicFloat ?? 0,
      shareholders,
      superShareMultiplier: corporation.superShareMultiplier ?? undefined,
      superSharesAdoptedAtTurn: corporation.superSharesAdoptedAtTurn ?? undefined,
      dividendRate: corporation.dividendRate ?? 0,
      lastDividendChange: corporation.lastDividendChange ?? null,
      lastShareIssuance: corporation.lastShareIssuance ?? null,
      shareBuybackMode: corporation.shareBuybackMode ?? "instant",
      shareEscrowBalance: corporation.shareEscrowBalance ?? 0,
      escrowFundingPerTurn: corporation.escrowFundingPerTurn ?? 0,
      lastEscrowWithdrawalTurn: corporation.lastEscrowWithdrawalTurn ?? undefined,
      lastShareholderAddressAt: corporation.lastShareholderAddressAt ?? null,
      legalStructure: corporation.legalStructure ?? undefined,
      legalStructureLabel: corpLegalStructure.shortName,
      legalStructureChangeCooldownUntilTurn:
        corporation.legalStructureChangeCooldownUntilTurn ?? null,
      lastShareStructureTurn: corporation.lastShareStructureTurn ?? null,
      // Era-scaled share-structure references. The reverse-split floor and the
      // "founding size" shortcut are both share COUNTS, so they deflate with
      // the era exactly like the mint sites do — otherwise a 1953 corp (whose
      // founding base is ~143k shares) sits permanently below a modern 1M
      // floor and can never reverse-split.
      shareConsolidationMinTotalShares: getEraFounderShares(
        SHARE_CONSOLIDATION_MIN_TOTAL_SHARES,
        resolvePresetIdFromGameState(gameState)
      ),
      foundingTotalShares: getEraFounderShares(
        CEO_INITIAL_SHARES,
        resolvePresetIdFromGameState(gameState)
      ),
      shareStructureCooldownTurnsRemaining:
        corporation.lastShareStructureTurn != null
          ? Math.max(
              0,
              corporation.lastShareStructureTurn + SHARE_STRUCTURE_COOLDOWN_TURNS - currentTurn
            )
          : 0,
      ceoVacant: corporation.ceoVacant ?? false,
      ceoCharacterId:
        corporation.ceoType === "character" && corporation.ceoId
          ? corporation.ceoId.toString()
          : null,
      // Underlying owner while a caretaker NPP runs the corp. Lets the front end
      // keep the CEO Office tab (and the "Resume Control" button) reachable for
      // the appointing owner even though the resolved `ceo` is now the NPP.
      caretakerUnderlyingCharacterId:
        corporation.caretakerCeo?.underlyingCharacterId?.toString() ?? null,
      // Turns left on the post-reclaim cooldown before a new caretaker may be installed.
      caretakerReappointCooldownTurnsRemaining: caretakerReappointCooldownRemaining(
        corporation,
        currentTurn
      ),
      pendingCeoCharacterId: corporation.pendingCeoCharacterId?.toString() ?? null,
      lastRenameTurn: corporation.lastRenameTurn ?? null,
      countryOwnerId: corporation.countryOwnerId ?? null,
      isNationalized: corporation.isNationalized ?? false,
      isPrivate: corporation.isPrivate ?? false,
      lastIpoTurn: corporation.lastIpoTurn ?? undefined,
      lastPrivatizationTurn: corporation.lastPrivatizationTurn ?? undefined,
      createdAt: corporation.createdAt,
      // Persisted, announced credit rating from the last turn's snapshot. Used as
      // the display LABEL so the page matches the credit-rating-change notification
      // (which is fired from this same persisted snapshot). The live /bonds recompute
      // double-smooths (feeds the already-smoothed composite back through the 0.75/0.25
      // blend), so it can diverge from the announced value — issuance pricing still
      // uses that live recompute, but the shown rating should be the announced one.
      creditRatingSnapshot: corporation.creditRatingSnapshot ?? undefined,
      creditCompositeSnapshot: corporation.creditCompositeSnapshot ?? undefined,
      // Suggestion #62: index-fund ownership and whether it has reached the
      // level that earns the credit notch and the price premium. Surfaced so
      // inclusion is a visible, chaseable goal rather than an invisible buff.
      indexOwnershipPercent: Math.round(indexFundOwnershipFraction(corporation) * 1000) / 10,
      indexInclusionActive:
        (corporation.isPrivate ?? false)
          ? false
          : qualifiesForIndexInclusionBenefit(indexFundOwnershipFraction(corporation)),
      parentCorporation: parentCorporationPayload,
      subsidiaries: subsidiariesPayload,
      hostileTakeoverEligibility,
      isFormalizedSubsidiary: isFormalizedSub,
      canFormalizeAsSubsidiary,
      canManageAsParent,
      canSpinOff,
      parentDividendFloorPct: activeFloorPct > 0 ? activeFloorPct : undefined,
    },
    ceo:
      ceo && !corporation.ceoVacant
        ? {
            characterId: corporation.ceoId.toString(),
            name: ceo.name,
            avatarUrl: ceo.avatarUrl,
            sequentialId: ceo.sequentialId,
            isImperial: isImperialCeo,
            isNpp: isNppCeo,
            // Canonical profile route per CEO kind. NPP CEOs resolve to the
            // politician NPP profile (not /character/, which 404s for an NPP id).
            profilePath: isImperialCeo
              ? `/imperial/${ceo.sequentialId}`
              : isNppCeo
                ? `/politicians/npp/${ceo.sequentialId}`
                : `/character/${ceo.sequentialId}`,
            borderKey: ceo.userId
              ? (corpBorderMap.get(ceo.userId.toString())?.borderKey ?? null)
              : null,
            tintColor: ceo.userId
              ? (corpBorderMap.get(ceo.userId.toString())?.tintColor ?? null)
              : null,
          }
        : null,
    ceoIsInactive,
    financials,
    sectors: sectorDetails.map((sd) => {
      const tax = perSectorTax.get(sd._id.toString());
      return {
        ...sd,
        federalTaxPaid: tax?.federalTaxPaid ?? 0,
        stateTaxPaid: tax?.stateTaxPaid ?? 0,
        federalTaxRate: tax?.federalTaxRate ?? 0,
        stateTaxRate: tax?.stateTaxRate ?? 0,
      };
    }),
    balanceSheet,
  };
}
