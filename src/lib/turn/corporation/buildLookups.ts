import type { Db } from "mongodb";
import { findMergedRegionMetricsMany } from "@/lib/macroMetrics/merge";
import type {
  Character,
  Corporation,
  CorporateSector,
  FederalBudget,
  StateBudget,
  State,
  CentralBank,
  Bond,
  Tariff,
  ExchangeRate,
  StateResourceCapacity,
  UnownedSector,
  GameState,
} from "@/lib/db/types";
import type { Crisis } from "@/lib/db/types/crisis";
import { buildDisasterEffectsByState } from "@/lib/crises/disasterMarginPenalty";
import type { CommodityPrice } from "@/lib/db/types";
import type { TradeFlowSnapshot } from "@/lib/db/types/tradeFlowSnapshot";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { COUNTRY_CURRENCY_MAP, eraRateForCurrency } from "@/lib/constants/currencies";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { isCorporateIssuerBond } from "@/lib/bonds/corporateCredit";
import { buildPrimeRateByCountry } from "@/lib/centralBank/helpers";
import { isCurtained } from "@/lib/constants/commandEconomy";
import { capInputPriceRatioAtWorld } from "@/lib/corporations/physicalPnl";
import { getActiveSubsidies } from "@/lib/subsidies/subsidyEffects";
import { buildFtaCoverageLookup, loadActiveFtaPairs } from "@/lib/tariffs/ftaOverrides";
import { reconcileSignedTariffBills } from "@/lib/tariffs/reconcileTariffs";
import { reconcileSignedEmbargoBills } from "@/lib/trade/reconcileEmbargoes";
import { buildTradeAffinity } from "@/lib/trade/tradeAffinity";
import { buildCountryClearingBooks } from "@/lib/market/tradePartition";
import { COUNTRY_ORDER } from "@/lib/constants/countries";
import type { TradeEmbargo } from "@/lib/db/types/tradeEmbargo";
import type { OrganizationMembership } from "@/lib/db/types/internationalOrganization";
import {
  getUnemploymentMarginModifier,
  getGridReliabilityMarginModifier,
  getCorruptionMarginModifier,
  getWorkforceSkillMarginModifier,
  getCrimeRateMarginModifier,
  getBroadbandMarginModifier,
  getRoadConditionMarginModifier,
  getCarbonEmissionsMarginModifier,
  getCostOfLivingMarginModifier,
  getInflationMarginModifier,
  getDebtToGdpMarginModifier,
  getDeficitToGdpMarginModifier,
} from "@/lib/constants/corporations";
import { INVESTOR_CONFIDENCE_BASELINE } from "@/lib/nationalization/constants";
import { NATIONAL_SCOPE, NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { buildPoliticalBaseModifiers } from "@/lib/politicalLegislation/marginAdapter";
import type { PoliticalMetricsDoc } from "@/lib/db/types/politicalMetrics";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { resolveGameYear } from "@/lib/era/era";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";
import type { EconomicModelState } from "@/lib/constants/economicModels";
import type { CorporationLookups } from "./types";
import {
  buildBondAndImfPortfolioAnchorByCorpId,
  buildCrossCorpStockHoldingsByHolderCorpId,
  buildImfPrincipalAnchorByLenderCorpId,
  buildPortfolioAnchorValueByCorpId,
} from "@/lib/corporations/portfolioAnchorValuation";
import { corpCapitalToAnchor } from "@/lib/currency/corporationCapital";
import { buildNationalCommodityBalances } from "@/lib/commodity-map";
import {
  buildMarketShareBySectorId,
  buildNationalDominanceShareBySectorId,
} from "@/lib/corporations/marketShare";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { buildSovereignDefaultMarginByCorpId } from "@/lib/sovereignDefault/marginPenalty/buildPerCorpMap";
import { getCurrentTurn } from "@/lib/turn/currentTurn";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  eraScaledBasePrices,
  EXTRACTABLE_RESOURCES,
  extractionOutputScaleFor,
  SECTOR_SUPPLY,
} from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import {
  computeExtractionCapacityMultipliers,
  type ExtractionSectorInput,
} from "@/lib/turn/extraction/extractionCapacity";
import { depletedCapacityDoc } from "@/lib/extraction/depletion";
import { getEraUnitScale } from "@/lib/constants/sectorSeedEra";
import { getExtractionOutputScaleEnabled } from "@/lib/market/featureFlag";
import {
  getExtractionContractsCollection,
  activeExtractionContractFilter,
} from "@/lib/db/collections/extractionContracts";
import {
  haircutScarcityRelief,
  scarcityReliefCappedUtilization,
} from "@/lib/extraction/capacityHaircut";
import type { SourcingNetworkDoc } from "@/lib/logistics/sourcingLedger";

export async function buildCorporationLookups(
  db: Db,
  options?: {
    /**
     * Plants tier (marketSystemMode >= "plants"): compute per-sector market
     * share on the owned-capacity basis instead of revenue. Omitted/false
     * keeps the legacy revenue-based share exactly.
     */
    plantsEnabled?: boolean;
    /**
     * Money wiring (interstate-logistics plan step 5, phase A):
     * gameConfig.interstateMoneyWiringEnabled. When true, loads last turn's
     * sourcingNetworkLoad doc and exposes its landedPremiums as
     * `landedPremiumByState`. Omitted/false keeps that map empty.
     */
    moneyWiringEnabled?: boolean;
    /** Use lagged freight-delivery availability as a local input constraint. */
    freightSettlementActive?: boolean;
    /**
     * Canonical freight billing v1 (issue #897):
     * gameConfig.canonicalFreightBillingEnabled. When true, loads last turn's
     * sourcingNetworkLoad billing aggregates as `freightChargesByDestState` /
     * `freightHaulRevenueByOriginState`. Omitted/false keeps both maps empty,
     * so the corporation turn computes and writes nothing.
     */
    canonicalFreightBillingEnabled?: boolean;
  }
): Promise<CorporationLookups> {
  await reconcileSignedTariffBills(db);

  // Corporate-presence suppression: a COMPREHENSIVE embargo (all commodities,
  // block, BOTH directions) by country S against country T means T-national
  // corporations may not operate in S — their sectors located in S are suspended
  // (revenue frozen, no income) while the embargo is active. Targeted
  // single-commodity embargoes keep their trade-lane-only effect, and — per
  // ticket 984 — so do one-directional embargoes: a US *import* ban on Japan
  // blocks goods crossing the border but must NOT shut a Japanese corp's
  // US-based factories (the "Toyota plants in Kentucky are American factories"
  // case). Only a both-direction embargo (a total severing of relations) freezes
  // in-country foreign operations. Keyed "operatingCountry|nationality".
  const embargoTurn = await getCurrentTurn(db);
  await reconcileSignedEmbargoBills(db, embargoTurn);
  const corporateEmbargoSuppression = new Set<string>();
  const totalEmbargoes = await db
    .collection<TradeEmbargo>("tradeEmbargoes")
    .find({
      commodity: "all",
      mode: "block",
      $and: [
        // Active = no expiry, or expiry still in the future (matches commodityPriceTurn).
        { $or: [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: embargoTurn } }] },
        // Comprehensive only: import/export-directional embargoes don't suppress a
        // foreign corp's in-country production. Legacy rows predating the
        // `direction` field were authored as total embargoes → treat as "both".
        { $or: [{ direction: "both" }, { direction: { $exists: false } }] },
      ],
    })
    .toArray();
  for (const e of totalEmbargoes) {
    if (e.sourceCountry && e.targetCountry) {
      corporateEmbargoSuppression.add(`${e.sourceCountry}|${e.targetCountry}`);
    }
  }

  const [
    corporations,
    allSectors,
    allStateMetrics,
    commodityPrices,
    centralBanks,
    activeBonds,
    federalBudgets,
    stateBudgets,
    allTariffs,
    activeSubsidies,
    states,
    exchangeRateDocs,
    stateResourceCapacityDocs,
    activeFtaPairs,
    unownedSectorDocs,
    latestTradeSnapshot,
    orgMembershipDocs,
    activeEmbargoDocs,
    worldPreset,
  ] = await Promise.all([
    db.collection<Corporation>("corporations").find({}).toArray(),
    db.collection<CorporateSector>("corporateSectors").find({}).toArray(),
    // Legacy-shaped view so the headline maps, condition modifiers, and the
    // margin engine's stored-value reads keep their single-doc shape.
    findMergedRegionMetricsMany(db, {}),
    // Projected to the fields actually read by this file (and the
    // buildNationalCommodityBalances helper it feeds). commodityPrices
    // documents carry per-state supply/demand maps which can be large; the
    // unread fields (history, metadata, etc.) compound per turn.
    db
      .collection<CommodityPrice>("commodityPrices")
      .find(
        {},
        {
          projection: {
            _id: 1,
            commodity: 1,
            globalSupply: 1,
            globalDemand: 1,
            globalPrice: 1,
            basePrice: 1,
            stateSupply: 1,
            stateDemand: 1,
            stateInputAvailability: 1,
            statePlacedSupply: 1,
            stateDeliveryLimitedSupply: 1,
            nationalSupply: 1,
            nationalDemand: 1,
            reachablePrices: 1,
          },
        }
      )
      .toArray() as Promise<CommodityPrice[]>,
    // Only countryId + primeRate read here; the doc is NOT returned from
    // buildCorporationLookups so downstream consumers are unaffected.
    db
      .collection<CentralBank>("centralBanks")
      .find({}, { projection: { countryId: 1, primeRate: 1, primeRateSmoothed: 1 } })
      .toArray() as Promise<CentralBank[]>,
    // All active bonds — sovereigns included. Issuer-side filtering (corporate-only)
    // happens in the bondsByCorpId loop below; holder-side keeps everything so
    // sovereign bonds held by corps contribute to portfolio anchor / share price.
    db.collection<Bond>("bonds").find({ matured: false }).toArray(),
    db
      .collection<FederalBudget>("federalBudget")
      .find(
        {},
        {
          projection: {
            countryId: 1,
            "economicFactors.inflationRate": 1,
            debtToGdpRatio: 1,
            surplus: 1,
            gdp: 1,
            "taxRates.domesticCorporateTax": 1,
            "taxRates.foreignCorporateTax": 1,
            // Per-country authored GDP-share targets (fiscal-scale audit,
            // 2026-07-29) - updateCorporateTaxBases below reads
            // taxBaseGdpShareBaseline.{domestic,foreign}CorporateProfits as the
            // per-country floor share instead of the universal
            // GDP_DOMESTIC/FOREIGN_CORPORATE_FACTOR constants. Must be
            // projected here or it silently reads undefined for every budget.
            taxBaseGdpShareBaseline: 1,
            // Labour system (v1 minimum wage, v3 Phase 7b union-law bias) —
            // both read via lookups.federalBudgets in turn/corporation/index.ts
            // (buildMinWageRatioByCountry / buildUnionLawBiasByCountry). Must
            // be projected here or those builders silently see every budget
            // as absent/neutral.
            minimumWageKaitzRatio: 1,
            unionLawBias: 1,
            unionsBanned: 1,
          },
        }
      )
      .toArray(),
    db
      .collection<StateBudget>("stateBudgets")
      .find(
        {},
        {
          projection: {
            _id: 1,
            "taxRates.domesticCorporateTax": 1,
            "taxRates.foreignCorporateTax": 1,
          },
        }
      )
      .toArray(),
    db.collection<Tariff>("tariffs").find({}).toArray(),
    getActiveSubsidies(db),
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1, gdp: 1, sectorSpecializations: 1 } })
      .toArray(),
    // Only currencyCode + rate read; consumed only as exchangeRatesByCurrency map.
    db
      .collection<ExchangeRate>("exchangeRates")
      .find({}, { projection: { currencyCode: 1, rate: 1 } })
      .toArray() as Promise<ExchangeRate[]>,
    db
      .collection<StateResourceCapacity>("stateResourceCapacity")
      .find({}, { projection: { stateId: 1, resources: 1 } })
      .toArray(),
    loadActiveFtaPairs(db),
    db.collection<UnownedSector>("unownedSectors").find({}).toArray(),
    // Latest trade-flow snapshot (prev turn) → per-country export intensity for
    // the export-reward margin premium. One small doc.
    db
      .collection<TradeFlowSnapshot>("tradeFlowSnapshots")
      .find({}, { sort: { turn: -1 }, limit: 1 })
      .toArray(),
    // Trade-graph inputs for the market partition (era worlds): shared org
    // blocs and ALL active embargoes (the suppression query above keeps only
    // comprehensive ones; the affinity graph needs every block/cap lane).
    db
      .collection<OrganizationMembership>("organizationMemberships")
      .find({}, { projection: { countryId: 1, organizationId: 1 } })
      .toArray(),
    db
      .collection<TradeEmbargo>("tradeEmbargoes")
      .find({
        $or: [{ expiresTurn: { $exists: false } }, { expiresTurn: { $gte: embargoTurn } }],
      })
      .toArray(),
    loadWorldPreset(db),
  ]);

  // Backfill countryId on corporations and sectors missing it (pre-migration data)
  const stateCountryMap = new Map(states.map((s) => [s._id, s.countryId]));
  const stateSectorSpecializationByState = new Map(
    states
      .filter((s) => s.sectorSpecializations)
      .map((s) => [
        s._id,
        {
          primary: s.sectorSpecializations!.primary,
          secondary: s.sectorSpecializations!.secondary,
        },
      ])
  );
  for (const corp of corporations) {
    if (!corp.countryId) {
      (corp as { countryId: string }).countryId =
        stateCountryMap.get(corp.headquartersState) ?? "US";
    }
  }
  for (const sector of allSectors) {
    if (!sector.countryId) {
      (sector as { countryId: string }).countryId = stateCountryMap.get(sector.stateId) ?? "US";
    }
  }

  // Issuer-side map: corporate bonds only. Sovereign issuers are synthetic IDs
  // and don't participate in the corporate credit-rating system that consumes
  // bondsByCorpId downstream.
  const bondsByCorpId = new Map<string, Bond[]>();
  for (const b of activeBonds) {
    if (!isCorporateIssuerBond(b)) continue;
    const cid = b.corporationId.toString();
    const list = bondsByCorpId.get(cid) ?? [];
    list.push(b);
    bondsByCorpId.set(cid, list);
  }

  // Holder-side map: ALL active bonds, including sovereigns. A corp parking cash
  // in US Treasuries holds a real liquidatable asset; the corporation API counts
  // it via heldBondsRaw, the share-price formula must too. Excluding sovereigns
  // here was the root cause of corps appearing artificially "broke" after
  // moving cash into safe sovereign debt (Aurora -38.4% incident, 2026-04-19).
  const bondsHeldByCorpId = new Map<string, { bond: Bond; units: number }[]>();
  for (const b of activeBonds) {
    for (const h of b.holders ?? []) {
      const holderCorpId = h.corporationId?.toString();
      if (!holderCorpId) continue;
      const held = bondsHeldByCorpId.get(holderCorpId) ?? [];
      held.push({ bond: b, units: h.units });
      bondsHeldByCorpId.set(holderCorpId, held);
    }
  }

  const corpById = new Map(corporations.map((c) => [c._id.toString(), c]));

  // Business Acumen: load the player CEO's stat for each character-run, non-vacant
  // corp and key it by corp. A skilled CEO grows their sectors more cheaply and is
  // less exposed to high interest rates (applied in calculateDailyGrowthCost).
  // NPP/imperial CEOs and vacant seats are skipped (treated as neutral downstream).
  const playerCeoIds = corporations
    .filter((c) => c.ceoId && !c.ceoVacant && (c.ceoType === "character" || c.ceoType == null))
    .map((c) => c.ceoId!)
    .filter((id, i, arr) => arr.findIndex((x) => x.equals(id)) === i);
  const ceoStatByCharId = new Map<string, number>();
  if (playerCeoIds.length > 0) {
    const ceoChars = await db
      .collection<Character>("characters")
      .find({ _id: { $in: playerCeoIds } }, { projection: { _id: 1, stats: 1 } })
      .toArray();
    for (const ch of ceoChars) {
      ceoStatByCharId.set(ch._id.toString(), ch.stats?.businessAcumen ?? NEUTRAL_STAT);
    }
  }
  const ceoBusinessAcumenByCorpId = new Map<string, number>();
  for (const corp of corporations) {
    if (!corp.ceoId || corp.ceoVacant || (corp.ceoType !== "character" && corp.ceoType != null)) {
      continue;
    }
    const stat = ceoStatByCharId.get(corp.ceoId.toString());
    if (stat != null) {
      ceoBusinessAcumenByCorpId.set(corp._id.toString(), stat);
    }
  }

  // Sum of `totalIssued` for each corp's active (non-defaulted) corporate bonds —
  // subtracted from balance-sheet equity in the share-price formula so issuing a
  // bond is neutral on share price (cash up, debt up, net zero). Natcorps are
  // exempt: their interest is government-subsidized (perTurnBondDragOnNetIncome=0)
  // and their principal is treated as sovereign-backed. Defaulted bonds are
  // excluded — they no longer represent a payable obligation.
  // Issued bond debt per corp, ₳-normalized. Each bond's `totalIssued` is
  // LOCAL in `bond.currencyCode` (Task-18B); for a same-currency issuer this
  // is a single-currency sum, but for corps whose bonds span currencies the
  // raw sum mixes denominations (and the share-price formula reads this map
  // as ₳). Normalize per-bond. (A27)
  const exchangeRatesByCurrency = new Map<CurrencyCode, number>(
    exchangeRateDocs.map((r) => [r.currencyCode as CurrencyCode, r.rate])
  );
  // The corporation turn needs an economic conversion rate even when a
  // currency is deliberately not player-traded. Six 1953 command-economy
  // currencies have no exchangeRates document, but their sector revenue,
  // profit, cash, debt, and share values are still stored in local units.
  // Falling back to 1.0 inflated every anchor value by 13.5x to 27x. Preserve
  // every live rate and fill only absent currencies from the authored preset.
  for (const code of Object.values(COUNTRY_CURRENCY_MAP) as CurrencyCode[]) {
    if (exchangeRatesByCurrency.has(code)) continue;
    const authoredRate = eraRateForCurrency(code, worldPreset);
    if (authoredRate !== undefined) exchangeRatesByCurrency.set(code, authoredRate);
  }
  const issuedBondDebtByCorpId = new Map<string, number>();
  for (const [corpId, bonds] of bondsByCorpId) {
    const issuer = corpById.get(corpId);
    if (issuer?.countryOwnerId) continue; // natcorp — government backstops principal
    let totalAnchor = 0;
    for (const b of bonds) {
      if (b.defaulted) continue;
      const bondCcy = (b.currencyCode ??
        (b.countryId && b.countryId in COUNTRY_CURRENCY_MAP
          ? COUNTRY_CURRENCY_MAP[b.countryId as keyof typeof COUNTRY_CURRENCY_MAP]
          : undefined)) as CurrencyCode | undefined;
      const bondFxRate = bondCcy ? (exchangeRatesByCurrency.get(bondCcy) ?? 1) : 1;
      totalAnchor += corpCapitalToAnchor(b.totalIssued, bondCcy, bondFxRate);
    }
    if (totalAnchor > 0) issuedBondDebtByCorpId.set(corpId, totalAnchor);
  }

  // Build sector presence keys for tariff blend weight computation.
  // getTariffBlendWeights uses these to decide whether origin_country and corp-specific
  // tariffs should shift the global/local commodity blend for a given (country, sectorType).
  const sectorPresenceKeys = new Set<string>();
  for (const sector of allSectors) {
    const sectorCountry = sector.countryId;
    const corp = corpById.get(sector.corporationId.toString());
    if (!corp) continue;
    const corpCountry = corp.countryId;
    // Only cross-border presence shifts the blend; domestic sectors don't need keys
    if (sectorCountry === corpCountry) continue;
    sectorPresenceKeys.add(`${sectorCountry}:${corpCountry}:${sector.sectorType}`);
    sectorPresenceKeys.add(`${sectorCountry}:corp:${corp._id.toString()}:${sector.sectorType}`);
  }

  // Member-aware: the ECB doc carries countryId "DE"; keying by bank.countryId
  // would make IE sectors fall back to the configured default prime rate.
  const primeRateByCountry = buildPrimeRateByCountry(centralBanks);
  // EMA of the prime rate (fomcMeetingTurn advances it each turn). Consumed by
  // the share-price formula ONLY — loans/coupons/growth costs stay on spot.
  const primeRateSmoothedByCountry = buildPrimeRateByCountry(
    centralBanks.map((b) => ({
      ...b,
      primeRate:
        typeof (b as CentralBank).primeRateSmoothed === "number" &&
        Number.isFinite((b as CentralBank).primeRateSmoothed)
          ? ((b as CentralBank).primeRateSmoothed as number)
          : b.primeRate,
    }))
  );

  // Build per-country macroeconomic modifier lookups from federal budgets
  const macroInflationByCountry = new Map<string, number>();
  const macroDebtToGdpByCountry = new Map<string, number>();
  const macroDeficitByCountry = new Map<string, number>();
  // Per-country investor confidence (spec §12.4 feed 1). Absent ⇒ baseline.
  const investorConfidenceByCountry = new Map<string, number>();
  // Per-country State Ownership Concentration Index (SOCI, 0–100). Absent ⇒ 0.
  const stateOwnershipConcentrationByCountry = new Map<string, number>();
  // Domestic rate applies to corps HQ'd in the same country as the sector; foreign rate
  // applies to all other corps. Per-sector selection happens in sectorCalculations.ts.
  const domesticCorpTaxRateByCountry = new Map<string, number>();
  const foreignCorpTaxRateByCountry = new Map<string, number>();
  for (const budget of federalBudgets) {
    const cid = budget.countryId;
    if (!cid) continue;
    const inflationRate = budget.economicFactors?.inflationRate ?? null;
    if (inflationRate != null) {
      macroInflationByCountry.set(cid, getInflationMarginModifier(inflationRate));
    }
    const debtRatio = budget.debtToGdpRatio ?? null;
    if (debtRatio != null) {
      macroDebtToGdpByCountry.set(cid, getDebtToGdpMarginModifier(debtRatio));
    }
    const gdp = budget.gdp || 1;
    const surplusToGdp = (budget.surplus ?? 0) / gdp;
    macroDeficitByCountry.set(cid, getDeficitToGdpMarginModifier(surplusToGdp));
    const domRate = budget.taxRates?.domesticCorporateTax;
    if (typeof domRate === "number") domesticCorpTaxRateByCountry.set(cid, domRate);
    const forRate = budget.taxRates?.foreignCorporateTax;
    if (typeof forRate === "number") foreignCorpTaxRateByCountry.set(cid, forRate);
    investorConfidenceByCountry.set(cid, budget.investorConfidence ?? INVESTOR_CONFIDENCE_BASELINE);
    stateOwnershipConcentrationByCountry.set(cid, budget.stateOwnershipConcentration ?? 0);
  }

  // §6.2 (P7b): per-country LAGGED economic model, from the national-scope metric
  // docs. The corp turn runs BEFORE this turn's classification phase, so the stored
  // value is last turn's (the §7 lag). Used for the corp alignment margin modifier.
  const economicModelByCountry = new Map<string, EconomicModelState>();
  for (const m of allStateMetrics) {
    const cid = NATIONAL_SCOPE[String(m._id)];
    if (cid && m.economicModel) economicModelByCountry.set(cid, m.economicModel);
  }

  // Sovereign-default sector margin penalty (Phase 7): per-corp lookup combining
  // local + global contagion contributions from every recovering country.
  //
  // FX FIX: federalBudget.gdp is denominated in the country's local currency
  // (USD for US, JPY for JP, etc. — see budget.ts comment). Comparing
  // defaultingCountry.gdp / globalGdp without conversion mixes denominations
  // and skews the contagion factor by whichever currency has larger nominal
  // numbers (yen-denominated GDP would dominate a raw sum). Normalize each
  // budget's GDP into anchor units before passing through.
  const gdpToAnchor = (b: Pick<FederalBudget, "countryId" | "gdp">): number => {
    const local = b.gdp ?? 0;
    if (local <= 0) return 0;
    const ccy = b.countryId ? COUNTRY_CURRENCY_MAP[b.countryId as CountryId] : undefined;
    const rate = ccy ? exchangeRatesByCurrency.get(ccy) : undefined;
    return rate && rate > 0 ? local / rate : local;
  };
  const recoveringBudgets = federalBudgets.filter(
    (b) =>
      b.sovereignCrisisState === "recovering" &&
      typeof b.lastDefaultTurn === "number" &&
      b.crisisChoice
  );
  const sovereignDefaultMarginByCorpId =
    recoveringBudgets.length > 0
      ? buildSovereignDefaultMarginByCorpId({
          recoveringBudgets: recoveringBudgets.map((b) => ({ ...b, gdp: gdpToAnchor(b) })),
          corps: corporations.map((c) => ({
            _id: c._id,
            countryId: c.countryId,
            type: c.type,
          })),
          currentTurn: await getCurrentTurn(db),
          globalGdp: federalBudgets.reduce((acc, b) => acc + gdpToAnchor(b), 0),
        })
      : new Map<string, number>();

  // Build per-state domestic/foreign corporate tax rate maps for per-sector state tax.
  const domesticStateCorpTaxRateByState = new Map<string, number>();
  const foreignStateCorpTaxRateByState = new Map<string, number>();
  for (const sb of stateBudgets) {
    const dom = sb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticStateCorpTaxRateByState.set(sb._id, dom);
    const fgn = sb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignStateCorpTaxRateByState.set(sb._id, fgn);
  }

  // Build global, national, and per-state commodity balance lookups for margin modifiers.
  // Margin modifiers start at 50% global + 25% national + 25% state and shift toward
  // the national bucket as tariff pressure rises. National totals prefer
  // cp.nationalSupply/nationalDemand so federal injections (e.g. govt healthcare)
  // that never land in any state still flow into the modifier math.
  const globalCommodityBalances = new Map<CommodityType, { supply: number; demand: number }>();
  const nationalCommodityBalancesByCountry = new Map<
    CountryId,
    Map<CommodityType, { supply: number; demand: number }>
  >();
  const rawStateBalances = new Map<
    string,
    Map<CommodityType, { supply: number; demand: number }>
  >();
  // Lagged price-over-base per STATE, the state twin of
  // `reachablePriceRatioByCountry`. Feeds the price-realization leg for
  // state-scoped commodities, so a seller in a locally short
  // state is paid that state's scarcity price rather than the national one.
  const statePriceRatioByState = new Map<string, Map<CommodityType, number>>();
  const stateInputAvailabilityByState = new Map<string, Map<CommodityType, number>>();
  const statePlacementRatioByState = new Map<string, Map<CommodityType, number>>();
  const stateDeliveryLimitedRatioByState = new Map<string, Map<CommodityType, number>>();
  // Market rework (marketSystemMode >= "realization"): lagged price-over-base
  // ratio per commodity. commodityPrices docs hold the price computed by the
  // PRIOR commodity-price pass, so reading them here is the one-turn lag that
  // breaks the price->revenue->supply->price circularity.
  const priceRatioByCommodity = new Map<CommodityType, number>();
  const reachablePriceRatioByCountry = new Map<string, Map<CommodityType, number>>();
  for (const cp of commodityPrices) {
    globalCommodityBalances.set(cp.commodity, {
      supply: cp.globalSupply,
      demand: cp.globalDemand,
    });
    if (
      typeof cp.globalPrice === "number" &&
      typeof cp.basePrice === "number" &&
      Number.isFinite(cp.globalPrice / cp.basePrice) &&
      cp.globalPrice > 0 &&
      cp.basePrice > 0
    ) {
      priceRatioByCommodity.set(cp.commodity, cp.globalPrice / cp.basePrice);
    }

    // Lagged per-country reachable price ratios (partition worlds). Feeds
    // clearing's price-realization leg AND the physical input bill so a
    // partitioned buyer pays ITS market's price level, not the worldwide one
    // — observed live (t174): US farms billed fertilizer at the world 2.38x
    // while their own reachable market sold it at 1.08x, so margins FELL as
    // the domestic shortage cleared. Sparse: absent countries fall back to
    // `priceRatioByCommodity` at each consumer.
    if (typeof cp.basePrice === "number" && cp.basePrice > 0 && cp.reachablePrices) {
      for (const [countryId, price] of Object.entries(cp.reachablePrices)) {
        if (!(typeof price === "number" && price > 0)) continue;
        let byCommodity = reachablePriceRatioByCountry.get(countryId);
        if (!byCommodity) {
          byCommodity = new Map<CommodityType, number>();
          reachablePriceRatioByCountry.set(countryId, byCommodity);
        }
        byCommodity.set(cp.commodity, price / cp.basePrice);
      }
    }

    for (const stateId of Object.keys(cp.stateSupply)) {
      if (!rawStateBalances.has(stateId)) {
        rawStateBalances.set(stateId, new Map());
      }
      rawStateBalances.get(stateId)!.set(cp.commodity, {
        supply: cp.stateSupply[stateId] ?? 0,
        demand: cp.stateDemand[stateId] ?? 0,
      });
    }

    if (typeof cp.basePrice === "number" && cp.basePrice > 0 && cp.statePrices) {
      for (const [stateId, price] of Object.entries(cp.statePrices)) {
        if (!(typeof price === "number" && price > 0)) continue;
        let byCommodity = statePriceRatioByState.get(stateId);
        if (!byCommodity) {
          byCommodity = new Map<CommodityType, number>();
          statePriceRatioByState.set(stateId, byCommodity);
        }
        byCommodity.set(cp.commodity, price / cp.basePrice);
      }
    }

    if (options?.freightSettlementActive) {
      for (const [stateId, availability] of Object.entries(cp.stateInputAvailability ?? {})) {
        if (!Number.isFinite(availability)) continue;
        if (!stateInputAvailabilityByState.has(stateId)) {
          stateInputAvailabilityByState.set(stateId, new Map());
        }
        stateInputAvailabilityByState
          .get(stateId)!
          .set(cp.commodity, Math.max(0, Math.min(1, availability)));
      }
      // Sell-side twin of the availability read above: the share of a state's
      // own output that last turn's network could place. Sectors offer into a
      // COUNTRY-scoped clearing book while their goods move on a STATE-scoped
      // network, so without this the offer claims deliveries the network never
      // made (t225: 60.4% of world production stranded in a state that did not
      // need it, against 28.7% of world demand unmet). Missing state, missing
      // doc field, or zero supply all mean "no evidence of a limit" and are
      // read as a ratio of 1 by the consumer.
      for (const [stateId, placed] of Object.entries(cp.statePlacedSupply ?? {})) {
        if (!Number.isFinite(placed)) continue;
        const supply = cp.stateSupply?.[stateId] ?? 0;
        if (!(supply > 0)) continue;
        if (!statePlacementRatioByState.has(stateId)) {
          statePlacementRatioByState.set(stateId, new Map());
        }
        statePlacementRatioByState
          .get(stateId)!
          .set(cp.commodity, Math.max(0, Math.min(1, placed / supply)));
      }
      // Second ratio, same denominator, different question. The placement ratio
      // caps the OFFER (the book should shrink whatever the reason, glut
      // included); this one is the only figure allowed to tell a player their
      // goods could not get there. Keeping them apart is the whole point: the
      // two states of the world call for opposite decisions.
      for (const [stateId, deliveryLimited] of Object.entries(
        cp.stateDeliveryLimitedSupply ?? {}
      )) {
        if (!Number.isFinite(deliveryLimited)) continue;
        const supply = cp.stateSupply?.[stateId] ?? 0;
        if (!(supply > 0)) continue;
        if (!stateDeliveryLimitedRatioByState.has(stateId)) {
          stateDeliveryLimitedRatioByState.set(stateId, new Map());
        }
        stateDeliveryLimitedRatioByState
          .get(stateId)!
          .set(cp.commodity, Math.max(0, Math.min(1, deliveryLimited / supply)));
      }
    }

    const perCountry = buildNationalCommodityBalances(cp, stateCountryMap);
    for (const [countryId, balance] of perCountry) {
      if (!nationalCommodityBalancesByCountry.has(countryId as CountryId)) {
        nationalCommodityBalancesByCountry.set(countryId as CountryId, new Map());
      }
      nationalCommodityBalancesByCountry.get(countryId as CountryId)!.set(cp.commodity, balance);
    }
  }

  // Per-country INPUT price ratios: the world map overlaid with each
  // country's reachable ratios, CAPPED AT THE WORLD RATIO per commodity.
  // The input bill is linear and unclamped while revenue realization is
  // damped (ratio^0.5, max 1.5x), so billing inputs above the world level
  // hands every buyer a cost no seller-side leg can capture back. Observed
  // live (t175): pinned bloc reachable ratios (steel FR 4.1x vs world 2.0x)
  // fed straight into the bill and put ~70% of all corps at negative income
  // in one turn. min(world, reachable) keeps the t174 fix (buyers in cheap
  // reachable markets stop paying world) without the blowup. World-map
  // fallback per commodity; base-price fallback only where the world has no
  // ratio either.
  const reachableInputPriceRatiosByCountry = new Map<string, Map<CommodityType, number>>();
  for (const [countryId, byCommodity] of reachablePriceRatioByCountry) {
    const merged = new Map(priceRatioByCommodity);
    for (const [commodity, ratio] of byCommodity) {
      const world = priceRatioByCommodity.get(commodity);
      merged.set(commodity, capInputPriceRatioAtWorld(world, ratio));
    }
    reachableInputPriceRatiosByCountry.set(countryId, merged);
  }

  // Per-country export intensity from the latest trade snapshot: for each
  // commodity a country net-exports, the fraction of its surplus that cleared
  // abroad ∈ [0,1]. Feeds the export-reward margin premium. Empty when no
  // snapshot exists yet (pre-first-trade-turn).
  const exportIntensityByCountry = new Map<CountryId, Map<CommodityType, number>>();
  const tradeSnapshotDoc = latestTradeSnapshot[0];
  if (tradeSnapshotDoc) {
    for (const [commodity, cf] of Object.entries(tradeSnapshotDoc.commodities) as Array<
      [CommodityType, NonNullable<TradeFlowSnapshot["commodities"][CommodityType]>]
    >) {
      for (const [countryId, pc] of Object.entries(cf.perCountry)) {
        if (pc.net <= 0 || pc.exports <= 0) continue;
        const surplusValue = pc.exports + Math.max(0, pc.uncleared);
        const intensity = surplusValue > 0 ? pc.exports / surplusValue : 0;
        if (intensity <= 0) continue;
        if (!exportIntensityByCountry.has(countryId as CountryId)) {
          exportIntensityByCountry.set(countryId as CountryId, new Map());
        }
        exportIntensityByCountry.get(countryId as CountryId)!.set(commodity, intensity);
      }
    }
  }

  // Build per-state margin modifier lookups
  const unemploymentByState = new Map<string, number>();
  const gridReliabilityByState = new Map<string, number>();
  const corruptionByState = new Map<string, number>();
  const workforceSkillByState = new Map<string, number>();
  const rawWorkforceSkillByState = new Map<string, number>();
  // Phase 2 labour rationing: prior-turn labour market tightness, written by
  // the previous corporation turn's telemetry pass. Read LAGGED by one turn on
  // purpose. Rationing needs each state's TOTAL demand before it can allocate,
  // and the sector loop only learns the total after it has finished, so a
  // same-turn figure would mean a second pass over every sector. Lagging is the
  // same trade the smoothed prime rate and the inflation passthrough already
  // make, and labour supply does not move fast enough for one turn to matter.
  const labourTightnessByState = new Map<string, number>();
  const labourDemandWageIndexByState = new Map<string, number>();
  const crimeRateByState = new Map<string, number>();
  const broadbandByState = new Map<string, number>();
  const roadConditionByState = new Map<string, number>();
  const carbonEmissionsByState = new Map<string, number>();
  const costOfLivingByState = new Map<string, number>();

  for (const sm of allStateMetrics) {
    const stateId = String(sm._id);
    const uRate = sm.economic?.unemploymentRate?.value;
    if (typeof uRate === "number") {
      unemploymentByState.set(stateId, getUnemploymentMarginModifier(uRate));
    }
    const gridVal = sm.infrastructure?.powerGridReliability?.value;
    if (typeof gridVal === "number") {
      gridReliabilityByState.set(stateId, getGridReliabilityMarginModifier(gridVal));
    }
    const corrVal = sm.governance?.corruptionIndex?.value;
    if (typeof corrVal === "number") {
      corruptionByState.set(stateId, getCorruptionMarginModifier(corrVal));
    }
    const tightnessVal = sm.economic?.labourTightness?.value;
    if (typeof tightnessVal === "number" && Number.isFinite(tightnessVal)) {
      labourTightnessByState.set(stateId, tightnessVal);
    }
    const demandWageIndex = sm.economic?.labourDemandWageIndex?.value;
    if (typeof demandWageIndex === "number" && Number.isFinite(demandWageIndex)) {
      labourDemandWageIndexByState.set(stateId, demandWageIndex);
    }
    const skillVal = sm.education?.workforceSkill?.value;
    if (typeof skillVal === "number") {
      workforceSkillByState.set(stateId, getWorkforceSkillMarginModifier(skillVal));
      rawWorkforceSkillByState.set(stateId, skillVal);
    }
    const crimeVal = sm.publicSafety?.crimeRate?.value;
    if (typeof crimeVal === "number") {
      crimeRateByState.set(stateId, getCrimeRateMarginModifier(crimeVal));
    }
    const bbVal = sm.infrastructure?.broadbandAccess?.value;
    if (typeof bbVal === "number") {
      broadbandByState.set(stateId, getBroadbandMarginModifier(bbVal));
    }
    const roadVal = sm.infrastructure?.roadCondition?.value;
    if (typeof roadVal === "number") {
      roadConditionByState.set(stateId, getRoadConditionMarginModifier(roadVal));
    }
    const carbonVal = sm.environment?.carbonEmissions?.value;
    if (typeof carbonVal === "number") {
      carbonEmissionsByState.set(stateId, getCarbonEmissionsMarginModifier(carbonVal));
    }
    const colVal = sm.economic?.costOfLiving?.value;
    if (typeof colVal === "number") {
      costOfLivingByState.set(stateId, getCostOfLivingMarginModifier(colVal));
    }
  }

  // Group sectors by corporation
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const sector of allSectors) {
    const key = sector.corporationId.toString();
    const list = sectorsByCorp.get(key) ?? [];
    list.push(sector);
    sectorsByCorp.set(key, list);
  }

  // Per-sector market share (₳-normalized) drives the dominance growth-cost
  // multiplier in calculateDailyGrowthCost. Built once per turn so every sector
  // pays the same dominance penalty the player-facing routes display.
  const stateById = new Map(states.map((s) => [s._id, s]));
  // Era-correct GDP→₳ normalization for the GDP-derived market fallback (refs
  // #3778). Read here rather than reusing the `gameState` fetch further down:
  // that one happens after this block, and reordering it would move several
  // unrelated reads inside the same turn phase.
  const marketSharePreset = worldPreset;
  // One era unit scale per world per turn: every ₳↔unit conversion downstream
  // reads this value from the lookups rather than re-resolving the preset.
  const eraUnitScale = getEraUnitScale(marketSharePreset);

  // Market partition (era worlds only): scope each seller's clearing book to
  // the demand its home country can actually reach under the live trade graph
  // (embargoes block, tariffs/geography drag, caps clamp — legislated autarky
  // lands here as embargo/tariff walls). Modern worlds (eraUnitScale === 1)
  // keep the single worldwide book: postwar-integrated trade is the modern
  // baseline, and partitioning it would only re-derive the same world market
  // with extra moving parts. See market/tradePartition.ts for book semantics.
  let countryClearingBooks: ReturnType<typeof buildCountryClearingBooks> | null = null;
  if (eraUnitScale !== 1) {
    const blocsByCountry = new Map<string, Set<string>>();
    for (const m of orgMembershipDocs) {
      if (!m.countryId || !m.organizationId) continue;
      if (!blocsByCountry.has(m.countryId)) blocsByCountry.set(m.countryId, new Set());
      blocsByCountry.get(m.countryId)!.add(String(m.organizationId));
    }
    // Iron curtain (mirrors commodityPriceTurn): planned economies trade only
    // among themselves; membership from the engine's MARKETIZATION_SCHEDULE via
    // isCurtained, so the curtain lifts on the historical marketization dates
    // and the Tito-split exemption keeps Yugoslavia trading with the open world.
    const [curtainCfg, curtainState] = await Promise.all([
      db
        .collection<{ _id: string; commandEconomyEnabled?: boolean }>("gameConfig")
        .findOne({ _id: "default" }, { projection: { commandEconomyEnabled: 1 } }),
      db
        .collection<GameState>("gameState")
        .findOne({ _id: "current" }, { projection: { currentYear: 1 } }),
    ]);
    const curtainEnabled = curtainCfg?.commandEconomyEnabled === true;
    const curtainYear = curtainState?.currentYear ?? null;
    const curtainedCountries = new Set<string>(
      COUNTRY_ORDER.filter((c) => isCurtained(c, curtainYear, curtainEnabled))
    );
    const { affinityFor, capUnitsFor } = buildTradeAffinity({
      ftaPairs: activeFtaPairs,
      blocsByCountry,
      tariffs: allTariffs,
      embargoes: activeEmbargoDocs,
      curtainedCountries,
    });
    countryClearingBooks = buildCountryClearingBooks({
      countries: COUNTRY_ORDER,
      nationalBalances: nationalCommodityBalancesByCountry,
      affinityFor,
      capUnitsFor,
    });
  }
  const marketShareBySectorId = buildMarketShareBySectorId({
    sectors: allSectors,
    corpById,
    stateById,
    unownedSectors: unownedSectorDocs,
    exchangeRatesByCurrency,
    preset: marketSharePreset,
    plantsEnabled: options?.plantsEnabled === true,
  });
  // National dominance share (revenue-basis, era-cancelling) so antitrust tolls
  // charge on max(local, national) and geographic spread can't dodge them.
  const nationalDominanceShareBySectorId = buildNationalDominanceShareBySectorId({
    sectors: allSectors,
    corpById,
    stateById,
    unownedSectors: unownedSectorDocs,
    exchangeRatesByCurrency,
    preset: marketSharePreset,
  });

  // Extraction capacity utilization (sectorId → { utilization, bindingResource }).
  // Computed here, in the corp phase, because commodityPriceTurn (which computes
  // the identical clamp for market supply) runs AFTER sector income is
  // calculated — the capacity revenue haircut needs these while processing
  // sectors. Mirrors the revenueBasedOutput construction in commodityPriceTurn.
  const extractionSectors = allSectors.filter((s) => s.sectorType === "extraction");
  const extractionCapacityUtilBySector = new Map<
    string,
    { utilization: number; bindingResource: ExtractableResource | null }
  >();
  if (extractionSectors.length > 0) {
    const capacityTurn = await getCurrentTurn(db);
    // Mirror the supply-ledger input exactly (commodityPriceTurn): the
    // extraction output-scale flag gates the per-resource boost, and the
    // ₳↔unit conversion runs on this world's ERA base-price table. The
    // previous modern-table figure here was 70-174x smaller than what the
    // ledger books on a 1953 world, so this clamp rationed against a
    // fraction of the sector's real desired output and never bound.
    const extractionOutputScaleEnabled = await getExtractionOutputScaleEnabled();
    const extractionBasePrices = eraScaledBasePrices(eraUnitScale);
    const extractionStateIds = [...new Set(extractionSectors.map((s) => s.stateId))];
    const activeContracts = await (
      await getExtractionContractsCollection(db)
    )
      .find({ stateId: { $in: extractionStateIds }, ...activeExtractionContractFilter() })
      .toArray();
    // Resolve each extraction sector's effective supply rates once, then reuse
    // them for both the capacity clamp input and the revenue-weighted utilization.
    const ratesBySector = new Map<string, Partial<Record<ExtractableResource, number>>>();
    const outputUnitsBySector = new Map<string, Partial<Record<ExtractableResource, number>>>();
    const extractionInputs: ExtractionSectorInput[] = extractionSectors.map((sector) => {
      const hasStrategy = sector.strategyId && sector.strategyId !== "standard";
      const strategyRates =
        hasStrategy || sector.transitionFromStrategyId
          ? getEffectiveStrategyRates(
              "extraction",
              sector.strategyId ?? "standard",
              sector.transitionFromStrategyId,
              sector.transitionStartTurn,
              capacityTurn
            )
          : null;
      const rates: Partial<Record<ExtractableResource, number>> = {};
      const revenueBasedOutput: Partial<Record<ExtractableResource, number>> = {};
      for (const resource of EXTRACTABLE_RESOURCES) {
        const rate = strategyRates
          ? (strategyRates.supply[resource] ?? 0)
          : ((SECTOR_SUPPLY["extraction"] ?? []).find((f) => f.commodity === resource)?.rate ?? 0);
        if (rate > 0) {
          rates[resource] = rate;
          // Identical expression to the ledger path: revenue x rate x
          // per-resource output scale, over the era-scaled base price. At
          // eraUnitScale 1 the table IS COMMODITY_BASE_PRICES and the scale
          // follows the same config flag as the ledger, so modern worlds are
          // unchanged whenever the ledger is.
          revenueBasedOutput[resource] =
            (sector.revenue *
              rate *
              extractionOutputScaleFor(resource, extractionOutputScaleEnabled)) /
            extractionBasePrices[resource];
        }
      }
      const sectorId = sector._id.toString();
      ratesBySector.set(sectorId, rates);
      outputUnitsBySector.set(sectorId, revenueBasedOutput);
      return {
        sectorId,
        stateId: sector.stateId,
        corporationId: sector.corporationId,
        revenueBasedOutput,
      };
    });
    // P3b: under plants the corp phase rations against the DEPLETION-ADJUSTED
    // ceiling, matching what commodityPriceTurn books the extraction against.
    // Without this the sector's revenue-side utilization and the world's supply
    // ledger would disagree about how much ore is left. Below plants the raw
    // docs are used, byte-identically.
    const multipliers = computeExtractionCapacityMultipliers(
      extractionInputs,
      activeContracts,
      options?.plantsEnabled === true
        ? stateResourceCapacityDocs.map(depletedCapacityDoc)
        : stateResourceCapacityDocs
    );
    // Scarcity relief: lift the haircut off resources in global shortage
    // (lagged balances — same one-turn lag as every market input) so the
    // haircut stops taxing exactly the extraction the economy is short of.
    const reliefByResource: Partial<Record<ExtractableResource, number>> = {};
    for (const resource of EXTRACTABLE_RESOURCES) {
      const bal = globalCommodityBalances.get(resource);
      const relief = haircutScarcityRelief(bal?.supply, bal?.demand);
      if (relief > 0) reliefByResource[resource] = relief;
    }
    for (const [sectorId, rates] of ratesBySector) {
      // Relief is capped at the raw capacity ratio over the CORRECTED
      // desired-output units: a sector whose desired output exceeds its
      // state's deposit ceiling cannot have the haircut lifted past what
      // those deposits can actually yield.
      extractionCapacityUtilBySector.set(
        sectorId,
        scarcityReliefCappedUtilization(
          rates,
          multipliers.get(sectorId),
          reliefByResource,
          outputUnitsBySector.get(sectorId)
        )
      );
    }
  }

  const imfPrincipalAnchorByLenderCorpId = buildImfPrincipalAnchorByLenderCorpId(
    corporations,
    exchangeRatesByCurrency
  );
  const bondAndImfPortfolioAnchorByCorpId = buildBondAndImfPortfolioAnchorByCorpId(
    bondsHeldByCorpId,
    imfPrincipalAnchorByLenderCorpId,
    exchangeRatesByCurrency
  );
  const crossCorpStockHoldingsByHolderCorpId =
    buildCrossCorpStockHoldingsByHolderCorpId(corporations);
  const portfolioAnchorValueByCorpId = buildPortfolioAnchorValueByCorpId(
    corporations,
    bondsHeldByCorpId,
    imfPrincipalAnchorByLenderCorpId,
    exchangeRatesByCurrency
  );

  // FTA coverage shares — used by getDomesticTariffMalus and getTariffBlendWeights
  // to scale supply-chain friction and commodity-blend tilt by partner exposure.
  // Built from already-loaded sectors + corpById; no extra DB roundtrips.
  const ftaCoverage = buildFtaCoverageLookup(allSectors, corpById, activeFtaPairs);

  // Active crisis decay margin effects indexed by stateId. One batched query;
  // no per-sector reads. Covers ALL active crises (auto-spawned disasters,
  // auto-crises, and admin-created crises) that carry a decay `profitMargin`
  // effect with a non-null `durationTurns`. The scope-aware resolver expands a
  // crisis to its affected states: global → every real state, country → that
  // country's states, region → its `regionIds`. So an economic crisis (Pandemic,
  // Recession, …) hits every corp in scope, not just region disasters.
  const disasterCrises = await db.collection<Crisis>("crises").find({ status: "active" }).toArray();
  const realStateIds: string[] = [];
  const stateIdsByCountry = new Map<string, string[]>();
  for (const s of states) {
    const id = String(s._id);
    if (NATIONAL_SCOPE_IDS.has(id)) continue;
    realStateIds.push(id);
    const arr = stateIdsByCountry.get(s.countryId) ?? [];
    arr.push(id);
    stateIdsByCountry.set(s.countryId, arr);
  }
  const resolveCrisisStateIds = (
    c: Pick<Crisis, "scope" | "countryIds" | "regionIds">
  ): readonly string[] =>
    c.scope === "global"
      ? realStateIds
      : c.scope === "country"
        ? c.countryIds.flatMap((cid) => stateIdsByCountry.get(cid) ?? [])
        : c.regionIds;
  const activeDisasterEffectsByState = buildDisasterEffectsByState(
    disasterCrises,
    resolveCrisisStateIds
  );

  const gameState = await db.collection<GameState>("gameState").findOne(
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
  );
  // Live year for era-aware regional-condition margins; null while the flag is off.
  const eraYear = gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null;

  // SP4 §4a: political margin overlays for playable regions — the sector-margin
  // engine resolves demolished political signals from these instead of the
  // (stripped) stateMetrics docs. One batch read, one map per region.
  const politicalDocs = await db
    .collection<PoliticalMetricsDoc>("politicalMetrics")
    .find({})
    .toArray();
  const politicalBaseModifiersByState = new Map(
    politicalDocs.map((doc) => [String(doc._id), buildPoliticalBaseModifiers(doc.values)])
  );
  const politicalBoardByState = new Map(politicalDocs.map((doc) => [String(doc._id), doc.values]));
  const regionalConditionMarginByState = new Map<string, number>();
  for (const metrics of allStateMetrics) {
    const stateId = String(metrics._id);
    if (NATIONAL_SCOPE_IDS.has(stateId)) continue;
    const modifiers = evaluateModifiers(buildFlatMetrics(metrics), {
      preset: gameState?.preset,
      countryId: metrics.countryId,
      year: eraYear,
    });
    regionalConditionMarginByState.set(stateId, computeRegionalConditionMargin(modifiers));
  }

  // Money wiring (interstate-logistics plan step 5, phase A): LAST turn's
  // landed-price premiums, loaded only when the flag is on. `embargoTurn`
  // above is this turn's number (getCurrentTurn), so "last turn" is the
  // latest sourcingNetworkLoad doc at or before it - the sourcing pass writes
  // its doc for `turn`, so on a normal cadence that's turn - 1, but reading
  // <= current turn survives a doc gap without going in-turn-mutation-order
  // sensitive.
  //
  // Canonical freight billing (issue #897) shares the same doc and the same
  // lag, so one fetch serves both flags.
  const landedPremiumByState = new Map<string, Map<CommodityType, number>>();
  const freightChargesByDestState = new Map<string, Map<CommodityType, number>>();
  const freightHaulRevenueByOriginState = new Map<string, number>();
  if (options?.moneyWiringEnabled || options?.canonicalFreightBillingEnabled) {
    const networkDoc = await db
      .collection<SourcingNetworkDoc>("sourcingNetworkLoad")
      .find({ turn: { $lte: embargoTurn } })
      .sort({ turn: -1 })
      .limit(1)
      .toArray();
    const doc = networkDoc[0];
    if (options?.moneyWiringEnabled && doc?.landedPremiums) {
      for (const [stateId, byCommodity] of Object.entries(doc.landedPremiums)) {
        const m = new Map<CommodityType, number>();
        for (const [commodity, premium] of Object.entries(byCommodity)) {
          if (typeof premium === "number" && premium > 0)
            m.set(commodity as CommodityType, premium);
        }
        if (m.size > 0) landedPremiumByState.set(stateId, m);
      }
    }
    if (options?.canonicalFreightBillingEnabled) {
      for (const [stateId, byCommodity] of Object.entries(doc?.freightCharges ?? {})) {
        const m = new Map<CommodityType, number>();
        for (const [commodity, charge] of Object.entries(byCommodity)) {
          if (typeof charge === "number" && charge > 0) m.set(commodity as CommodityType, charge);
        }
        if (m.size > 0) freightChargesByDestState.set(stateId, m);
      }
      for (const [stateId, revenue] of Object.entries(doc?.freightHaulRevenue ?? {})) {
        if (typeof revenue === "number" && revenue > 0)
          freightHaulRevenueByOriginState.set(stateId, revenue);
      }
    }
  }

  return {
    eraYear,
    eraUnitScale,
    corporations,
    sectorsByCorp,
    corpById,
    ceoBusinessAcumenByCorpId,
    bondsByCorpId,
    bondsHeldByCorpId,
    portfolioAnchorValueByCorpId,
    bondAndImfPortfolioAnchorByCorpId,
    issuedBondDebtByCorpId,
    crossCorpStockHoldingsByHolderCorpId,
    primeRateByCountry,
    primeRateSmoothedByCountry,
    macroInflationByCountry,
    investorConfidenceByCountry,
    stateOwnershipConcentrationByCountry,
    economicModelByCountry,
    macroDebtToGdpByCountry,
    macroDeficitByCountry,
    sovereignDefaultMarginByCorpId,
    stateMetricsByState: new Map(allStateMetrics.map((metrics) => [String(metrics._id), metrics])),
    politicalBaseModifiersByState,
    politicalBoardByState,
    unemploymentByState,
    gridReliabilityByState,
    corruptionByState,
    workforceSkillByState,
    rawWorkforceSkillByState,
    labourTightnessByState,
    labourDemandWageIndexByState,
    crimeRateByState,
    broadbandByState,
    roadConditionByState,
    carbonEmissionsByState,
    costOfLivingByState,
    globalCommodityBalances,
    stateInputAvailabilityByState,
    statePlacementRatioByState,
    stateDeliveryLimitedRatioByState,
    priceRatioByCommodity,
    reachablePriceRatioByCountry,
    reachableInputPriceRatiosByCountry,
    landedPremiumByState,
    freightChargesByDestState,
    freightHaulRevenueByOriginState,
    nationalCommodityBalancesByCountry,
    countryClearingBooks,
    exportIntensityByCountry,
    rawStateBalances,
    statePriceRatioByState,
    sectorPresenceKeys,
    allTariffs,
    activeFtaPairs,
    ftaCoverage,
    activeSubsidies,
    federalBudgets,
    domesticCorpTaxRateByCountry,
    foreignCorpTaxRateByCountry,
    domesticStateCorpTaxRateByState,
    foreignStateCorpTaxRateByState,
    exchangeRatesByCurrency,
    stateCountryMap,
    stateResourceCapacityByState: new Map(
      stateResourceCapacityDocs.map((doc) => [doc.stateId, doc.resources])
    ),
    extractionCapacityUtilBySector,
    marketShareBySectorId,
    nationalDominanceShareBySectorId,
    stateSectorSpecializationByState,
    activeDisasterEffectsByState,
    regionalConditionMarginByState,
    corporateEmbargoSuppression,
    // Legacy full-mothball embargo model DISABLED (ticket 984): always use the
    // trade-exposure model, which strips only the cross-border (export-exposed)
    // share of an embargoed sector's revenue and leaves domestic host-country
    // sales operating normally. The old model zeroed a foreign corp's entire
    // domestic production (realizedRevenue -> 0) even when its export exposure
    // was 0, wrongly bankrupting purely-domestic sectors under an import embargo.
    // The `gameState.embargoTradeExposureEnabled` flag is retained for
    // provenance but no longer gates behavior.
    embargoTradeExposureEnabled: true,
  };
}
