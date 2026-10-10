/**
 * Corporation turns settle operating results and distribute shareholder income.
 * processCorporationTurn shares monetary quotes across automatic dividend conversions.
 */
import { applyCorporationCashWrites } from "@/lib/turn/npp/foundingCashLedger";
import { loadConversionQuoteContext } from "@/lib/currency/euro/quotes";
import { ObjectId } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { StatePolicy } from "@/lib/db/types/statePolicy";
import type { State } from "@/lib/db/types/state";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { getDb } from "@/lib/mongodb";
import { refreshNationalBudgetRevenue } from "@/lib/budget/revenue";
import { buildCorporationLookups } from "./buildLookups";
import { buildFreightBillingBySector } from "./freightBillingTurn";
import { USE_GROWTH_INCREMENT, businessAcumenGrowthMultiplier } from "@/lib/stats/statsConstants";
import { shedVacantCeoSectorsToUnowned } from "./vacantCeoSectorShed";
import { shedInactiveCeoSectorsToUnowned } from "./inactiveCeoSectorShed";
import { installCaretakersForVacantCorps } from "./autoCaretakerVacantCorps";
import { processSectors } from "./sectorCalculations";
import { getLabourSystemMode, labourAtLeast } from "@/lib/labour/featureFlag";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import { buildMarketContext } from "@/lib/market/marketContext";
import { isFairnessDoctrineInEffect } from "@/lib/mediaRegulation/rules";
import { runClearingPrePass } from "./clearingPrePass";
import { computeQualityUpdates } from "./brandQualityTurn";
import { consumeManufacturingDevelopmentReceiptsV2 } from "@/lib/products/manufacturingProjectPersistence";
import { processAdvertisingTurn } from "@/lib/advertising/settlementTurn";
import { loadAdvertisingEfficacyByCorp } from "@/lib/advertising/persistence";
import type { CoverageSectorInput } from "@/lib/advertising/rules/coverage";
import {
  MANUFACTURING_PRODUCT_PROJECTS_V2,
  type ManufacturingProductProject,
} from "@/lib/products/manufacturingProject";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import { settleSupplyAgreements, type SettleableSupplyAgreement } from "./settleSupplyAgreements";
import type { CommodityType } from "@/lib/constants/commodities";
import { loadSettleableSupplyAgreements } from "./loadSettleableSupplyAgreements";
import {
  buildMinWageRatioByCountry,
  buildUnionLawBiasByCountry,
  buildUnionsBannedByCountry,
  type LabourContext,
} from "@/lib/labour/laborCost";
import { buildUnionEffectsById } from "@/lib/unions/unionLookups";
import { loadUndergroundStrengthByCountrySector } from "@/lib/unions/undergroundEffects";
import { loadCollectiveAgreementEffects } from "@/lib/unions/collectiveAgreementEffects";
import { loadIndustrialActionOutputFactors } from "@/lib/unions/industrialActionEffects";
import {
  fireStrikeStartedPulse,
  fireStrikeResolvedPulse,
} from "@/lib/corporations/sentimentEvents";
import { processRdInnovations } from "./rdInnovation";
import { fillPendingShareOrders } from "./shareOrders";
import { expireShareListings } from "./shareListings";
import { processVoteReminders, processVoteAutoResolve } from "./voteReminders";
import { snapshotMarketCap } from "./marketCapSnapshot";
import { processImfBailoutPayments } from "@/lib/turn/imfBailoutTurn";
import { buildPersonalBalanceBulkOp, getHomeCurrency } from "@/lib/currency/characterFunds";
import { isForexEnabled } from "@/lib/currency/featureFlag";
import { isSectorTechTreesEnabled } from "@/lib/corporations/techTree/featureFlag";
import {
  executeMarketMakerTrade,
  distributeConversionSpreadsBatch,
} from "@/lib/currency/marketMaker";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";

import { loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { toInternalUnits } from "@/lib/lineOfCredit/locMath";
import { garnishLocFromIncome } from "@/lib/lineOfCredit/garnishment";
import { loadTxThresholds } from "@/lib/financialTxLog/emit";
import { runSoeBackingSweep } from "./soeBackingSweep";
import { processPendingNationalizations } from "@/lib/nationalization/pendingNationalizations";
import { processNationalizationAuctions } from "@/lib/nationalization/privatizationAuction";
import { processNppCorporationDecisions } from "@/lib/turn/nppCorporationBehavior";
import {
  buildTechUnlockFlushAudit,
  flushNppTechUnlockLedger,
} from "@/lib/corporations/techTree/techUnlockLedger";
import { processNppSupplyAgreements } from "@/lib/turn/npp/nppSupplyAgreements";
import { processNppProspecting } from "@/lib/turn/npp/nppProspecting";
import { processNppCorpTreasury } from "@/lib/turn/npp/nppCorpTreasury";
import { createNotifications } from "@/lib/notifications";
import { COMMODITY_LABELS, eraScaledBasePrices } from "@/lib/constants/commodities";
import { trackFinancialDistress } from "./financialDistressTracking";
import {
  persistLabourIndices,
  persistLabourMarketTelemetry,
  creditCorpDividends,
  updateCorporateTaxBases,
  emitCorporationTurnTx,
} from "./corporationTurnPhases";
import { getGameState } from "@/lib/gameState";
import { unprotectedConstructionPropertyFilter } from "@/lib/corporations/securedConstructionProperty";
import { requestConstructionFinance } from "@/lib/banking/constructionFinance";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import { logger } from "../../observability/logger";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";
import { createCorporationTurnTimer, type CorporationTurnResult } from "./corporationTurnRuntime";
import { processEquityMarketPoolTurn } from "@/lib/equities/marketPoolTurn";
import { placePendingShareIssuances } from "@/lib/equities/primaryMarket";
import { creditEquityPoolsBatch } from "@/lib/equities/marketPool";
import { partitionedBulkWrite } from "./partitionedBulkWrite";
import {
  applyPoliticalMediaOrderEffect,
  loadPoliticalMediaOrdersForClearing,
  savePoliticalMediaSettlementPlan,
  settlePoliticalMediaOrder,
  type PoliticalMediaOrderForClearing,
} from "@/lib/politicalMedia/journal";
import { applyMediaEditorialEffects } from "@/lib/mediaEditorial/applyEffects";
import { addSettledPoliticalAttention } from "@/lib/mediaOperatingModels/reach";
import { applyOperatingCashThenDevelopmentCash } from "./manufacturingDevelopmentCashSettlement";
import { loadVentureBoostBySectorId, processProductVentures } from "@/lib/products/venture/turn";
import { ventureDomainsEnabled } from "@/lib/products/venture/access";
import { startNppVentures } from "@/lib/products/venture/nppStart";
import { getNppCashFloorAnchor } from "@/lib/turn/npp/nppCashReserve";
import { resumeFoundingUnderwritingPlans } from "@/lib/banking/underwritingSettlement";
import {
  processMediaProductProjectsV1,
  startNppMediaProductsV1,
} from "@/lib/products/mediaProductPersistence";
import {
  attributeMediaProductSales,
  paidPoliticalMediaSellerReceipts,
  reconcileMediaProductDelivery,
  type PaidPoliticalMediaSellerAmount,
} from "@/lib/products/rules/mediaProductSales";
import { persistMediaProductSales } from "@/lib/products/mediaProductSales";
import { getMediaProductKind } from "@/lib/products/mediaProductCatalog";
import { aggregateMediaProductSectorEffects } from "@/lib/products/rules/mediaProductRules";

export type { CorporationTurnResult } from "./corporationTurnRuntime";

// Optional sim-run salt, same convention as nppActionProcessing.ts's RNG.
const CORP_TURN_RNG_SALT = process.env.SIM_RNG_SALT ? `:${process.env.SIM_RNG_SALT}` : "";

/**
 * Run the corporation economy, settlement, ownership, and reporting phases for one turn.
 */

export async function processCorporationTurn(turn?: number): Promise<CorporationTurnResult> {
  const db = await getDb();
  const now = new Date();

  const timer = createCorporationTurnTimer();
  const mark = timer.mark;

  // The preamble reads are independent of each other, so they run as one
  // parallel round-trip instead of ~7 serial ones.
  //
  // marketGovernorConfig: structural market rework (audit t806), Fix 1 scales
  // realized sector revenue by the lagged market price of its outputs. Inert
  // when marketSystemMode is "off" (the default), no economic change. Read
  // HERE, before the lookup build, because the market-share basis below needs
  // the mode and the mode lives in this same document: two separate resolutions
  // per turn used to disagree in principle, so there is now exactly one read
  // and exactly one resolved mode for the whole turn. The commandEconomyEnabled
  // gate lives in the same document, so it rides the same projection.
  const [
    forexEnabled,
    techTreesEnabled,
    thresholds,
    // Subsidiary corporations feature gate (default off). Read once and thread
    // into processSectors so the parent dividend floor is only honored when on.
    { isSubsidiaryCorporationsEnabled },
    marketGovernorConfig,
    gameState,
    labourMode,
  ] = await Promise.all([
    isForexEnabled(),
    isSectorTechTreesEnabled(),
    loadTxThresholds(db),
    import("@/lib/corporations/subsidiaries/featureFlag"),
    db.collection<GameConfig>("gameConfig").findOne(
      { _id: "default" },
      {
        projection: {
          marketSystemMode: 1,
          productLinesV2Enabled: 1,
          marketGovernorCap: 1,
          marketGovernorRampTurns: 1,
          brandLoyaltyEnabled: 1,
          brandLoyaltySliceEnabled: 1,
          sectorQualityEnabled: 1,
          qualityPremiumPricingEnabled: 1,
          politicalMediaMarketEnabled: 1,
          explicitPlantCostsEnabled: 1,
          supplyAgreementsEnabled: 1,
          prospectingEnabled: 1,
          commandEconomyEnabled: 1,
          privateBankingEnabled: 1,
          bankUnderwritingEnabled: 1,
          interstateMoneyWiringEnabled: 1,
          freightSettlementMode: 1,
          canonicalFreightBillingEnabled: 1,
          treasuryCashLedgerEnabled: 1,
          mediaEditorialEnabled: 1,
          mediaOperatingModelsEnabled: 1,
          mediaRegulationEnabled: 1,
        },
      }
    ),
    getGameState(),
    getLabourSystemMode(),
  ]);
  mark("preamble");
  if (marketGovernorConfig?.bankUnderwritingEnabled === true) {
    await resumeFoundingUnderwritingPlans(db, now);
  }
  const equityPoolTurn = await processEquityMarketPoolTurn(
    db,
    turn ?? gameState?.currentTurn ?? 0,
    now
  );
  await placePendingShareIssuances(db, turn ?? gameState?.currentTurn ?? 0, now);
  mark("equityMarketPool");
  // SINGLE SOURCE OF TRUTH for this turn's market mode, both the market-share
  // basis just below and `buildMarketContext` further down consume it. Do not
  // re-resolve it; a second `getMarketSystemMode()` call is how the two drifted.
  const marketSystemMode = await getMarketSystemMode(marketGovernorConfig);

  // Phase 1: Build all lookup maps from DB (one parallel fetch)
  // Market share (which drives the dominance growth-cost multiplier) switches
  // to the owned-capacity basis under the plants tier.
  const plantsEnabledForMarketShare = marketAtLeast(marketSystemMode, "plants");
  const interstateMoneyWiringEnabled =
    (marketGovernorConfig as { interstateMoneyWiringEnabled?: boolean } | null)
      ?.interstateMoneyWiringEnabled === true;
  const freightSettlementActive =
    (marketGovernorConfig as { freightSettlementMode?: string } | null)?.freightSettlementMode ===
      "active" && marketAtLeast(marketSystemMode, "clearing");
  // Canonical freight billing v1 (issue #897, default OFF): while on, last
  // turn's per-state shipping money is loaded from the sourcingNetworkLoad doc
  // and apportioned across sectors below. Off keeps both lookup maps empty and
  // the whole billing path inert.
  const canonicalFreightBillingEnabled =
    (marketGovernorConfig as { canonicalFreightBillingEnabled?: boolean } | null)
      ?.canonicalFreightBillingEnabled === true;
  const mediaEditorialEnabled = marketGovernorConfig?.mediaEditorialEnabled === true;
  const mediaOperatingModelsEnabled = marketGovernorConfig?.mediaOperatingModelsEnabled === true;
  const mediaProductSlatesEnabled =
    marketAtLeast(marketSystemMode, "clearing") &&
    mediaOperatingModelsEnabled &&
    marketGovernorConfig?.mediaProductSlatesEnabled === true &&
    marketGovernorConfig?.brandLoyaltyEnabled === true &&
    marketGovernorConfig?.brandLoyaltySliceEnabled === true &&
    marketGovernorConfig?.qualityPremiumPricingEnabled === true;
  const mediaRegulationEnabled =
    marketAtLeast(marketSystemMode, "clearing") &&
    marketGovernorConfig?.mediaRegulationEnabled === true;
  const [lookups, mediaRegulationPolicy] = await Promise.all([
    buildCorporationLookups(db, {
      plantsEnabled: plantsEnabledForMarketShare,
      explicitPlantCostsEnabled:
        plantsEnabledForMarketShare && marketGovernorConfig?.explicitPlantCostsEnabled === true,
      productionTurn: turn,
      freightSettlementActive,
      moneyWiringEnabled: interstateMoneyWiringEnabled,
      canonicalFreightBillingEnabled,
      mediaEditorialEnabled:
        mediaEditorialEnabled ||
        (mediaRegulationEnabled &&
          typeof gameState?.currentYear === "number" &&
          gameState.currentYear <= 1986),
      mediaProductSlatesEnabled,
      politicalMediaMarketEnabled: marketGovernorConfig?.politicalMediaMarketEnabled === true,
      productLinesV2Enabled:
        plantsEnabledForMarketShare &&
        (marketGovernorConfig as { productLinesV2Enabled?: boolean } | null)
          ?.productLinesV2Enabled === true,
    }),
    mediaRegulationEnabled
      ? db
          .collection<StatePolicy>("statePolicies")
          .findOne(
            { legislationTypeId: "us_media_communications", stateId: "federal" },
            { projection: { policyOptionIndex: 1 } }
          )
      : Promise.resolve(null),
  ]);
  if (
    mediaProductSlatesEnabled &&
    lookups.mediaProductProjectsByCorpId &&
    typeof gameState?.currentYear === "number"
  ) {
    const startedNppProjects = await startNppMediaProductsV1({
      db,
      corporations: lookups.corporations,
      sectorsByCorp: lookups.sectorsByCorp,
      projectsByCorporationId: lookups.mediaProductProjectsByCorpId,
      currentYear: gameState.currentYear,
      currentTurn: turn ?? 1,
    });
    for (const project of startedNppProjects) {
      const development = lookups.mediaProductDevelopmentByCorpId ?? new Map();
      development.set(project.corporationId, project);
      lookups.mediaProductDevelopmentByCorpId = development;
      const bySector = lookups.mediaProductProjectsBySectorId ?? new Map();
      const sectorProjects = bySector.get(project.sectorId) ?? [];
      sectorProjects.push(project);
      bySector.set(project.sectorId, sectorProjects);
      lookups.mediaProductProjectsBySectorId = bySector;
    }
  }
  // Product ventures reuse the existing product flags: media titles follow the
  // slates flag, manufactured lines follow product lines v2. Read through the same helper the venture routes use. The governor
  // projection above does not carry mediaProductSlatesEnabled, so reading it
  // from there left every media venture unprocessed while players could start
  // them.
  const productVentureDomainsEnabled = await ventureDomainsEnabled(db);
  if (productVentureDomainsEnabled.media || productVentureDomainsEnabled.manufacturing) {
    lookups.productVentureBoostBySectorId = await loadVentureBoostBySectorId(db, {
      turn: turn ?? 1,
      sectorsByCorp: lookups.sectorsByCorp,
      enabled: productVentureDomainsEnabled,
    });
  }
  const politicalMediaMarketEnabled = marketGovernorConfig?.politicalMediaMarketEnabled === true;
  const politicalMediaOrders: PoliticalMediaOrderForClearing[] = politicalMediaMarketEnabled
    ? await loadPoliticalMediaOrdersForClearing(db, turn ?? 0)
    : [];
  // Coverage efficacy earned by last turn's advertising agreements. Empty when
  // the gate is off, which leaves product brand formation neutral.
  const advertisingEfficacyByCorpId = mediaOperatingModelsEnabled
    ? await loadAdvertisingEfficacyByCorp(db, (turn ?? gameState?.currentTurn ?? 0) - 1)
    : new Map<string, { turn: number; factor: number }>();
  if (lookups.productLinesV2Enabled && lookups.manufacturingProductByCorpId) {
    await consumeManufacturingDevelopmentReceiptsV2({
      db,
      corporations: lookups.corporations,
      projectsByCorporationId: lookups.manufacturingProductByCorpId,
      completedTurn: (turn ?? gameState?.currentTurn ?? 0) - 1,
      advertisingEfficacyByCorporationId: advertisingEfficacyByCorpId,
    });
  }
  const currentYear = gameState?.currentYear;
  // Soft-budget gate for the turn path (see sectorTurn's affordability brake and
  // nppInsolvencyDissolution, which already exempts planned economies). Read off
  // the preamble's gameConfig projection, same document, no second round-trip.
  const commandEconomyEnabled =
    (marketGovernorConfig as { commandEconomyEnabled?: boolean } | null)?.commandEconomyEnabled ===
    true;
  const privateBankingEnabled =
    (marketGovernorConfig as { privateBankingEnabled?: boolean } | null)?.privateBankingEnabled ===
    true;
  const treasuryCashLedgerEnabled = marketGovernorConfig?.treasuryCashLedgerEnabled === true;
  const subsidiaryCorporationsEnabled = await isSubsidiaryCorporationsEnabled(
    gameState ?? undefined
  );
  mark("buildLookups+gameState");

  // Labour/Unions system: when labourSystemMode ≥ "wages", sector profit carves
  // an explicit, per-sector/per-era labor cost out of maintenance (resolved per
  // sector inside processSectors from sectorType + currentYear). Inert (no
  // economic change) when the mode is off, the default.
  const fullEnabled = labourAtLeast(labourMode, "full");
  const bannedUnionCountryIds = buildUnionsBannedByCountry(lookups.federalBudgets);
  const [
    unionsById,
    collectiveAgreementEffects,
    industrialActionOutputFactorBySectorId,
    undergroundStrengthByCountrySector,
  ] = fullEnabled
    ? await Promise.all([
        buildUnionEffectsById(db, turn ?? gameState?.currentTurn ?? 0),
        loadCollectiveAgreementEffects(db, turn ?? gameState?.currentTurn ?? 0),
        loadIndustrialActionOutputFactors(db),
        loadUndergroundStrengthByCountrySector(db, bannedUnionCountryIds),
      ])
    : [undefined, undefined, undefined, undefined];
  const labour: LabourContext = {
    wagesEnabled: labourAtLeast(labourMode, "wages"),
    minWageRatioByCountry: buildMinWageRatioByCountry(lookups.federalBudgets),
    // v3 Phase 5/6: gates the NPC unionization metric + strikes.
    unionsEnabled: labourAtLeast(labourMode, "unions"),
    // v3 Phase 7b: gates union-law bias + union-busting.
    fullEnabled,
    unionLawBiasByCountry: buildUnionLawBiasByCountry(lookups.federalBudgets),
    // Union ban (player suggestion #93): read at the "unions" tier (the same
    // tier the unionization/strike machinery runs at), unlike the bias map
    // above whose reads are gated at "full".
    unionsBannedByCountry: bannedUnionCountryIds,
    undergroundStrengthByCountrySector,
    // Union dues v1: gated read, only fetched when fullEnabled, so a union
    // document's mere existence never has an effect at a lower tier. Resolved
    // per-sector via `CorporateSector.representingUnionId`, not by
    // (countryId, sectorType), see `sectorLabour.ts`.
    unionsById,
    collectiveAgreementWageFloorBySectorId: collectiveAgreementEffects?.wageFloorBySectorId,
    noStrikeProtectedSectorIds: collectiveAgreementEffects?.noStrikeProtectedSectorIds,
    industrialActionOutputFactorBySectorId,
  };
  mark("labourContext");

  const brandLoyaltyEnabled = marketGovernorConfig?.brandLoyaltyEnabled === true;
  const sectorQualityEnabled = marketGovernorConfig?.sectorQualityEnabled === true;
  // Quality → premium coupling only bites when quality is actually computed AND
  // the Package-B gate is on (default off ⇒ clearing revenue unchanged).
  const qualityPremiumPricingEnabled =
    sectorQualityEnabled && marketGovernorConfig?.qualityPremiumPricingEnabled === true;
  const supplyAgreementsEnabled = marketGovernorConfig?.supplyAgreementsEnabled === true;

  // Private supply agreements: contracted output per supplier corp per commodity.
  // A supply agreement reserves the contracted volume for the buyer (additive);
  // the supplier's surplus above it still clears on the open market.
  // Every per-corp contract map below is keyed by `supplyAgreementScopeKey`:
  // the bare commodity for a corporation-wide agreement, `commodity@stateId`
  // for a state-scoped one (freight), so a state contract is reserved,
  // produced and settled against that one state's plants.
  let contractedByCorpCommodity: Map<string, Map<string, number>> | undefined;
  let settleableAgreements: SettleableSupplyAgreement[] | undefined;
  // Corporation-wide agreements have no state identity. A live LEGACY agreement
  // for a state-local commodity (one signed before contracts named their
  // state) must finish under the legacy national book rather than being
  // silently reinterpreted or broken mid-contract. New agreements for these
  // commodities must name a state at proposal time.
  let stateLocalClearingBlockedByLegacyAgreement = false;
  // Populated during clearing: supplier corpId → scope key → contracted units
  // that actually cleared this turn. Drives the post-clearing premium settlement.
  const contractSettlementByCorp = new Map<string, Map<string, number>>();
  // Plants tier: supplier corpId → scope key → units actually produced this
  // turn (the offered book under plants IS real production). Drives the
  // supply-agreement shortfall penalty, a contract is a promise about goods,
  // so under-PRODUCING against it is the breach, not under-selling it.
  const producedByCorpCommodity = new Map<string, Map<string, number>>();
  // Ticket #1147: the involuntary-constraint ceiling, accumulated on exactly
  // the same corp/commodity keys as `producedByCorpCommodity` so the damages
  // leg can compare like with like. A supplier whose plants were starved of
  // inputs, throttled by a glutted market or struck is billed against what it
  // could have made, not against a nameplate it could never reach.
  const achievableByCorpCommodity = new Map<string, Map<string, number | null>>();
  if (supplyAgreementsEnabled) {
    contractedByCorpCommodity = new Map();
    settleableAgreements = [];
    const loaded = await loadSettleableSupplyAgreements({ db, turn: turn ?? 0, now });
    settleableAgreements = loaded.agreements;
    stateLocalClearingBlockedByLegacyAgreement = loaded.legacyStateLocalAgreementLive;
  }
  // The slice (A2b) only bites when BOTH the master flag and the slice gate are
  // on, accrual can run shadow (A1/A2) with the slice still off.
  const brandLoyaltySliceEnabled =
    brandLoyaltyEnabled && marketGovernorConfig?.brandLoyaltySliceEnabled === true;
  const market = buildMarketContext(marketSystemMode, {
    cap: marketGovernorConfig?.marketGovernorCap,
    rampTurns: marketGovernorConfig?.marketGovernorRampTurns,
  });
  market.explicitPlantCostsEnabled = marketGovernorConfig?.explicitPlantCostsEnabled === true;
  market.mediaRegulationEnabled = mediaRegulationEnabled;
  market.mediaEditorialEnabled = mediaEditorialEnabled;
  if (mediaRegulationEnabled) {
    market.mediaRegulationPolicyOptionIndex =
      typeof mediaRegulationPolicy?.policyOptionIndex === "number"
        ? Math.max(0, Math.min(6, Math.trunc(mediaRegulationPolicy.policyOptionIndex)))
        : 3;
    market.mediaFairnessDoctrineEnabled = isFairnessDoctrineInEffect(
      gameState?.currentYear,
      market.mediaRegulationPolicyOptionIndex
    );
  }
  // Canonical freight billing (issue #897): apportion last turn's state-scoped
  // shipping money onto sectors once, before the per-corp loop, and thread the
  // result through the market context like the delivery-limited telemetry.
  // Strictly flag-gated: with the flag off the lookup maps are empty, this
  // block is skipped, and processSector neither computes nor persists billing.
  if (canonicalFreightBillingEnabled) {
    const billing = buildFreightBillingBySector({
      lookups,
      currentTurn: turn ?? gameState?.currentTurn ?? 0,
      plantsEnabled: market.plantsEnabled,
      currentYear,
      commandEconomyEnabled,
    });
    market.freightBillingChargeBySectorId = billing.chargeBySectorId;
    market.freightBillingCreditBySectorId = billing.creditBySectorId;
  }
  // Clearing pre-pass: offer-book construction, the clearing-factors run,
  // canonical-basis book invariant diagnostics, delivered advertising value,
  // and the loyalty rollup. Lives in ./clearingPrePass so this entry point
  // stays under the architecture audit file-size cap. Same position in the
  // phase order, same inputs, no new reads or writes.
  const {
    clearingInvariantBreaches,
    brandLoyaltyUpdates,
    contractedByCorpCommodity: clearingContractedByCorpCommodity,
    buyerDemandByCorpCommodity,
    politicalMediaSettlementPlans,
  } = runClearingPrePass({
    lookups,
    market,
    turn,
    currentYear,
    commandEconomyEnabled,
    freightSettlementActive,
    supplyAgreementsEnabled,
    settleableAgreements,
    contractedByCorpCommodity,
    contractSettlementByCorp,
    producedByCorpCommodity,
    achievableByCorpCommodity,
    stateLocalClearingBlockedByLegacyAgreement,
    brandLoyaltyEnabled,
    brandLoyaltySliceEnabled,
    qualityPremiumPricingEnabled,
    politicalMediaOrders,
    treasuryCashLedgerEnabled,
  });
  const plannedPoliticalMediaOrders = new Map(
    politicalMediaSettlementPlans.map(({ orderId, plan }) => [orderId, plan])
  );
  for (const { orderId, plan } of politicalMediaSettlementPlans) {
    await savePoliticalMediaSettlementPlan(db, orderId, plan);
  }
  contractedByCorpCommodity = clearingContractedByCorpCommodity;
  if (mediaEditorialEnabled && !mediaOperatingModelsEnabled && market.editorialOutletsByState) {
    await applyMediaEditorialEffects({
      db,
      turn: turn ?? gameState?.currentTurn ?? 0,
      outletsByState: market.editorialOutletsByState,
    });
  }
  mark("marketContext");

  // Output quality (four pillars): compute per-sector quality → corp
  // averageQuality + per-commodity quality (propagates to next turn's inputs).
  // Independent of clearing; flag-gated. Display/telemetry only in this phase.
  let qualityCorpUpdates = new Map<string, number>();
  let newCommodityQuality: Map<CommodityType, number> | null = null;
  if (sectorQualityEnabled || lookups.productLinesV2Enabled || mediaProductSlatesEnabled) {
    const laggedQ = new Map<CommodityType, number>();
    const qDocs = await db
      .collection("commodityQuality")
      .find({}, { projection: { commodity: 1, quality: 1 } })
      .toArray();
    for (const d of qDocs as unknown as { commodity: CommodityType; quality: number }[]) {
      if (typeof d.quality === "number") laggedQ.set(d.commodity, d.quality);
    }
    const qCorps: import("./brandQualityTurn").QualityCorpInput[] = [];
    for (const [corpId, sectors] of lookups.sectorsByCorp) {
      const corp = lookups.corpById.get(corpId);
      const qSectors = sectors.map((sector) => {
        const rates = getEffectiveStrategyRatesForOperatingModel(
          sector.sectorType,
          sector.strategyId ?? "standard",
          sector.transitionFromStrategyId,
          sector.transitionStartTurn,
          turn ?? 0,
          sector.industryModel,
          sector.mediaDiscriminator
        );
        const outputs = (Object.keys(rates.supply ?? {}) as CommodityType[]).filter(
          (c) => (rates.supply?.[c] ?? 0) > 0
        );
        const inputs = (Object.keys(rates.demand ?? {}) as CommodityType[]).filter(
          (c) => (rates.demand?.[c] ?? 0) > 0
        );
        return {
          sectorId: sector._id.toString(),
          revenueWeight: Math.max(0, sector.revenue),
          wageLevel: typeof sector.wageLevel === "number" ? sector.wageLevel : 1,
          outputs,
          inputs,
        };
      });
      qCorps.push({
        corpId,
        techScore: corp?.rdScore ?? 0,
        operationsStrength: corp?.logisticsStrength ?? 0,
        sectors: qSectors,
      });
    }
    const { corpQuality, commodityQuality, sectorQualityBySectorId } = computeQualityUpdates(
      qCorps,
      laggedQ
    );
    lookups.productSectorQualityById = sectorQualityBySectorId;
    if (sectorQualityEnabled) {
      qualityCorpUpdates = corpQuality;
      newCommodityQuality = commodityQuality;
    }
    // Keep in-memory corp docs current so the history snapshot charts this turn.
    for (const [corpId, q] of corpQuality) {
      const corp = lookups.corpById.get(corpId);
      if (corp) corp.averageQuality = q;
    }
  }

  if (mediaProductSlatesEnabled && lookups.mediaProductProjectsByCorpId) {
    await processMediaProductProjectsV1({
      db,
      corporations: lookups.corporations,
      projectsByCorporationId: lookups.mediaProductProjectsByCorpId,
      currentTurn: turn ?? 1,
      sectorQualityBySectorId: lookups.productSectorQualityById ?? new Map(),
      advertisingEfficacyByCorporationId: advertisingEfficacyByCorpId,
    });
    const projectsBySectorId = new Map<
      string,
      import("@/lib/products/mediaProduct").MediaProductProject[]
    >();
    const developmentByCorpId = new Map<
      string,
      import("@/lib/products/mediaProduct").MediaProductProject
    >();
    for (const [corporationId, projects] of lookups.mediaProductProjectsByCorpId) {
      for (const project of projects) {
        const sectorProjects = projectsBySectorId.get(project.sectorId) ?? [];
        sectorProjects.push(project);
        projectsBySectorId.set(project.sectorId, sectorProjects);
        if (project.activeDevelopmentCorporationId) {
          developmentByCorpId.set(corporationId, project);
        }
      }
    }
    lookups.mediaProductProjectsBySectorId = projectsBySectorId;
    lookups.mediaProductDevelopmentByCorpId = developmentByCorpId;
    const mediaProductQualityBySectorId = new Map<string, number>();
    const mediaProductLoyaltyBonusBySectorId = new Map<string, number>();
    for (const sectors of lookups.sectorsByCorp.values()) {
      for (const sector of sectors) {
        const sectorId = sector._id.toString();
        const projects = (projectsBySectorId.get(sectorId) ?? []).flatMap((project) => {
          const kind = getMediaProductKind(project.kindId);
          return kind && sector.strategyId === kind.modelId
            ? [{ project: { ...project, id: project._id }, kind }]
            : [];
        });
        if (projects.length === 0) continue;
        const effect = aggregateMediaProductSectorEffects({
          projects,
          baseQuality: lookups.productSectorQualityById?.get(sectorId) ?? null,
        });
        if (effect.quality !== null) mediaProductQualityBySectorId.set(sectorId, effect.quality);
        if (effect.loyaltyBonus > 0) {
          mediaProductLoyaltyBonusBySectorId.set(sectorId, effect.loyaltyBonus);
        }
      }
    }
    lookups.mediaProductQualityBySectorId = mediaProductQualityBySectorId;
    lookups.mediaProductLoyaltyBonusBySectorId = mediaProductLoyaltyBonusBySectorId;
  }

  // Phase 1a2: auto-install NPP caretakers on corps left CEO-less by a hard
  // departure (retire/relocate/resign/residency/deletion/ban set ceoVacant), so
  // they run via the clamped NPP brain instead of shedding to unowned. Mutates
  // the in-memory corp docs, so it must precede the vacant/inactive sheds below.
  // Inactivity never sets ceoVacant, so idle-but-seated CEOs are not covered.
  const { installed: caretakersInstalled } = await installCaretakersForVacantCorps(db, lookups, {
    turn: turn ?? 0,
    now,
  });
  if (caretakersInstalled > 0) {
    console.log(
      `[corporationTurn] auto-installed ${caretakersInstalled} NPP caretaker(s) on vacant corp(s)`
    );
  }
  mark("autoCaretaker");

  // Forensics/alt-detection audit spine: aggregate, not-per-corp entries for
  // this turn's silent auto-mutations (vacant/inactive-CEO shedding, NPP
  // caretaker installs, subsidiary cleanup). Batched into one `recordAuditBulk`
  // at the end to avoid N+1 writes on the corp-turn hotspot.
  const corpAuditEntries: ActionAuditInput[] = [];
  if (caretakersInstalled > 0) {
    corpAuditEntries.push({
      source: "turn",
      category: "corp",
      action: "corp.auto_caretaker_install",
      phase: "corporationTurn",
      subject: { type: "corpBatch", name: "vacant-ceo corps" },
      outcome: "ok",
      meta: { count: caretakersInstalled },
    });
  }

  // Phase 1b: CEO-less player corps lose market footprint to unowned pools (same turn as step 2)
  // MUTATES lookups.sectorsByCorp, adjusts revenue/workers so processSectors sees reduced values.
  // Order matters: vacant shed runs first, then inactive-CEO shed (which excludes vacant corps).
  const vacantShedResult = await shedVacantCeoSectorsToUnowned(
    db,
    lookups,
    now,
    market.plantsEnabled
  );
  const inactiveShedResult = await shedInactiveCeoSectorsToUnowned(
    db,
    lookups,
    now,
    market.plantsEnabled
  );
  if (vacantShedResult.corporateSectorsUpdated > 0) {
    corpAuditEntries.push({
      source: "turn",
      category: "corp",
      action: "corp.auto_sector_shed",
      phase: "corporationTurn",
      subject: { type: "corpBatch", name: "vacant-ceo sector shed" },
      outcome: "ok",
      meta: {
        reason: "vacant_ceo",
        sectorsUpdated: vacantShedResult.corporateSectorsUpdated,
        revenueShed: Math.round(vacantShedResult.totalRevenueShed),
      },
    });
  }
  if (inactiveShedResult.corporateSectorsUpdated > 0) {
    corpAuditEntries.push({
      source: "turn",
      category: "corp",
      action: "corp.auto_sector_shed",
      phase: "corporationTurn",
      subject: { type: "corpBatch", name: "inactive-ceo sector shed" },
      outcome: "ok",
      meta: {
        reason: "inactive_ceo",
        sectorsUpdated: inactiveShedResult.corporateSectorsUpdated,
        revenueShed: Math.round(inactiveShedResult.totalRevenueShed),
      },
    });
  }
  mark("shedSectors");

  // Phase 2: Process all corporations and sectors (pure computation, no DB calls)
  const {
    sectorOps,
    corpOps,
    manufacturingDevelopmentCashOps,
    corpSnapshots,
    ceoSalaryPayments,
    dividendPayments,
    corpDividendPaymentsAnchorByCorpId,
    corpDividendPaymentsAnchorByCorpCurrency,
    sectorFxSpreadFees,
    fundDividendAccruals,
    equityPoolDividendAccruals,
    domesticIncomeByCountry,
    foreignIncomeByCountry,
    domesticIncomeByOperatingState,
    foreignIncomeByOperatingState,
    growthInvestmentByOperatingState,
    totalRevenueGenerated,
    totalIncomeGenerated,
    sectorsProcessed,
    profitMarginByCorpId,
    labourWageIndexByState,
    automationIndexByState,
    labourDemandByState,
    labourDemandWageIndexByState,
    strikeEvents,
    capacityBindingEvents,
    settledMarketingSpendAnchorByBuyerId,
    advertisingDeliveredAnchorBySellerId,
  } = processSectors(
    lookups,
    turn,
    now,
    techTreesEnabled,
    currentYear,
    labour,
    market,
    subsidiaryCorporationsEnabled,
    commandEconomyEnabled,
    privateBankingEnabled,
    new Set(equityPoolTurn.activeCurrencies),
    treasuryCashLedgerEnabled
  );
  mark("processSectors(CPU)");

  // Phase 2b: NPP corporation AI decisions, budgets, expansion, dividends
  // Run before bulk writes so NPP decisions are applied this turn.
  const {
    corpUpdates: nppCorpUpdates,
    sectorUpdates: nppSectorUpdates,
    newSectors: nppNewSectors,
    divestedSectorIds: nppDivestedSectorIds,
    techLedger: nppTechLedger,
    foundingCashWitnesses = [],
    reinvestmentCashWitnesses = [],
    manufacturingProductProjects: nppManufacturingProductProjects,
    constructionFinanceRequests: nppConstructionFinanceRequests,
    constructionFinanceCandidateCount: nppConstructionFinanceCandidateCount,
    constructionFinanceBacklogCount: nppConstructionFinanceBacklogCount,
  } = await processNppCorporationDecisions(db, turn ?? 0, now, techTreesEnabled, {
    corporations: lookups.corporations,
    issuerBondsByCorpId: lookups.bondsByCorpId,
    heldBondsByCorpId: lookups.bondsHeldByCorpId,
  });
  mark("nppCorpDecisions");

  for (const project of nppManufacturingProductProjects) {
    try {
      await db
        .collection<ManufacturingProductProject>(MANUFACTURING_PRODUCT_PROJECTS_V2)
        .insertOne(project);
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        continue;
      }
      throw error;
    }
  }

  // Merge NPP corp updates into the main corpOps
  for (const nppUpdate of nppCorpUpdates) {
    corpOps.push({
      updateOne: {
        filter: nppUpdate.filter,
        update: nppUpdate.update,
      },
    });
  }

  // Merge brand-loyalty updates (A2). Separate $set ops keyed by corp _id, they
  // only touch brandLoyalty/brandPostureNorm, so they compose with the main
  // corp $set for the same doc (Mongo merges multiple bulk ops per document).
  for (const lu of brandLoyaltyUpdates) {
    corpOps.push({
      updateOne: {
        filter: { _id: new ObjectId(lu.corpId) },
        update: {
          $set: {
            brandLoyalty: Math.round(lu.loyalty * 100) / 100,
            brandPostureNorm: Math.round(lu.postureNorm * 10000) / 10000,
          },
        },
      },
    });
  }

  // Merge quality updates (averageQuality per corp).
  for (const [corpId, q] of qualityCorpUpdates) {
    corpOps.push({
      updateOne: {
        filter: { _id: new ObjectId(corpId) },
        update: { $set: { averageQuality: q } },
      },
    });
  }

  // Merge NPP sector growth-rate updates into sectorOps
  for (const nppSectorUpdate of nppSectorUpdates) {
    sectorOps.push({
      updateOne: {
        filter: nppSectorUpdate.filter,
        update: nppSectorUpdate.update,
      },
    });
  }

  // Divest losing NPP sectors, remove from corporateSectors
  if (nppDivestedSectorIds.length > 0) {
    await db.collection("corporateSectors").deleteMany({
      _id: { $in: nppDivestedSectorIds },
      ...unprotectedConstructionPropertyFilter(),
    });
  }

  // v2: persist the per-state labour wage index (+ v2-3b: automation index) to
  // stateMetrics, see persistLabourIndices for the prior-value delta capture.
  // Only written when the labour system is on, so it's inert otherwise.
  await persistLabourIndices({
    db,
    wagesEnabled: labour.wagesEnabled,
    labourWageIndexByState,
    automationIndexByState,
  });

  // Phase 1 labour market telemetry: record how many jobs the corporate sector
  // wants per state and how that compares to the civilian labour force. Inert
  // measurement, deliberately not gated on the labour system being on.
  await persistLabourMarketTelemetry({
    db,
    labourDemandByState,
    labourDemandWageIndexByState,
    turn,
  });

  // Phase 3: Bulk write sector and corp updates
  if (sectorOps.length > 0) {
    // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing, runtime shape is valid.
    // Every op is keyed by its sector `_id`; ops on one sector (the flip-turn
    // `$push` after the main update) stay together and in order.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await partitionedBulkWrite(db.collection("corporateSectors"), sectorOps as any[]);
  }
  mark("sectorBulkWrite");
  if (corpOps.length > 0 || manufacturingDevelopmentCashOps.length > 0) {
    // Product development is capitalized separately, after operating P&L. The
    // explicit sequence keeps its live cash guard from racing unordered corpOps.
    await applyOperatingCashThenDevelopmentCash({
      productLinesV2Enabled: lookups.productLinesV2Enabled,
      db,
      operations: manufacturingDevelopmentCashOps,
      turn: typeof turn === "number" ? turn : 1,
      corporations: lookups.corporations,
      snapshots: corpSnapshots,
      exchangeRatesByCurrency: lookups.exchangeRatesByCurrency,
      bondsByCorpId: lookups.bondsByCorpId,
      sectorsByCorp: lookups.sectorsByCorp,
      mediaProductSlatesEnabled,
      applyOperatingCashWrites: async () => {
        if (corpOps.length === 0) return;
        // bulkWrite op array type does not satisfy AnyBulkWriteOperation narrowing, runtime shape is valid.
        await applyCorporationCashWrites(
          db,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          corpOps as any[],
          foundingCashWitnesses,
          reinvestmentCashWitnesses
        );
        mark("corpCashWrites");
        if (treasuryCashLedgerEnabled) {
          const { settleCorporateOperatingCash } = await import("./operatingCashSettlement");
          await settleCorporateOperatingCash(
            db,
            corpSnapshots,
            turn ?? gameState?.currentTurn ?? 1,
            now
          );
          mark("operatingCashSettlement");
        }
      },
    });
    mark("developmentCash");
  }
  if (productVentureDomainsEnabled.media || productVentureDomainsEnabled.manufacturing) {
    try {
      // Computer-run companies start their own products first; the debit,
      // events and outcome then run through the same path as a player's.
      await startNppVentures(db, {
        turn: typeof turn === "number" ? turn : 1,
        corporations: lookups.corporations,
        sectorsByCorp: lookups.sectorsByCorp,
        exchangeRatesByCurrency: lookups.exchangeRatesByCurrency,
        enabled: productVentureDomainsEnabled,
        reserveAnchor: getNppCashFloorAnchor(
          plantsEnabledForMarketShare ? lookups.preset : undefined
        ),
        priceRatioOf: (commodity, countryId) =>
          lookups.reachablePriceRatioByCountry?.get(countryId)?.get(commodity as never) ??
          lookups.priceRatioByCommodity.get(commodity as never),
        currentYear: gameState?.currentYear,
        techTreesEnabled: gameState?.sectorTechTreesEnabled === true,
      });
    } catch (error) {
      console.error("[corporationTurn] NPP product venture start failed", error);
    }
    mark("nppVentureStarts");
    try {
      await processProductVentures({
        db,
        turn: typeof turn === "number" ? turn : 1,
        corporations: lookups.corporations,
        sectorsByCorp: lookups.sectorsByCorp,
        exchangeRatesByCurrency: lookups.exchangeRatesByCurrency,
        enabled: productVentureDomainsEnabled,
      });
    } catch (error) {
      // A venture fault must never stop the corporation turn.
      console.error("[corporationTurn] product venture processing failed", error);
    }
    mark("productVentures");
  }
  let constructionFinanceFundedCount = 0;
  let constructionFinancePendingCount = 0;
  let constructionFinanceFailedCount = nppConstructionFinanceBacklogCount;
  for (const candidate of nppConstructionFinanceRequests) {
    const result = await requestConstructionFinance({
      db,
      enabled: true,
      sector: candidate.sector,
      corporation: candidate.corporation,
      bankId: candidate.bankId,
      requestId: `npp-${turn ?? 0}-${candidate.sector._id.toHexString()}`,
      principal: candidate.principal,
      termTurns: candidate.termTurns,
      constructionCostLocal: candidate.costLocal,
      collateralCostLocal: candidate.costLocal,
      maximumCostLocal: candidate.costLocal,
      order: candidate.order,
      preloadedFundingContext: candidate.preloadedFundingContext,
      buildContext: candidate.buildContext,
    });
    if (!result.ok) {
      constructionFinanceFailedCount += 1;
      continue;
    }
    if (result.pending) constructionFinancePendingCount += 1;
    else constructionFinanceFundedCount += 1;
  }
  if (nppConstructionFinanceCandidateCount > 0) {
    corpAuditEntries.push({
      source: "turn",
      category: "corp",
      action: "corp.npp_construction_finance",
      phase: "corporationTurn",
      subject: { type: "corpBatch", name: "NPP private-sector construction" },
      outcome: "ok",
      meta: {
        candidates: nppConstructionFinanceCandidateCount,
        attempted: nppConstructionFinanceRequests.length,
        funded: constructionFinanceFundedCount,
        pendingApproval: constructionFinancePendingCount,
        deferredOrRejected: constructionFinanceFailedCount,
        turn,
      },
    });
  }
  // Emit only for NPP unlocks proven applied above; the flush dedupes and
  // refunds any debit whose ledger row cannot be persisted (ticket #1998).
  if (nppTechLedger.length > 0) {
    const techFlush = await flushNppTechUnlockLedger(db, nppTechLedger);
    const techAudit = buildTechUnlockFlushAudit(techFlush);
    if (techAudit) corpAuditEntries.push(techAudit);
  }
  // One read plus one bulk write, instead of two serial round trips per
  // accrual against a collection holding one document per currency. Missing
  // pools are still skipped rather than upserted, preserving the legacy sink
  // on pre-migration worlds.
  await creditEquityPoolsBatch(db, equityPoolDividendAccruals, "dividendsIn", now);
  mark("sector+corp bulkWrites");

  // Advertising agreements attribute the spend this turn already settled across
  // each buyer's agreements and spot. Attribution only: no cash, revenue, or
  // market write. Gate off performs zero advertising reads or writes.
  if (mediaOperatingModelsEnabled) {
    const advertisingSectorsByCorp = new Map<string, CoverageSectorInput[]>();
    for (const [corpId, sectors] of lookups.sectorsByCorp) {
      advertisingSectorsByCorp.set(
        corpId,
        sectors.map((sector) => ({
          stateId: sector.stateId,
          revenue: sector.revenue,
          sectorType: sector.sectorType,
          countryId: sector.countryId,
          mothballed: sector.mothballed,
          embargoSuspended: sector.embargoSuspended,
          activeCapacityPercent: sector.activeCapacityPercent,
          strategyId: sector.strategyId,
        }))
      );
    }
    await processAdvertisingTurn(db, {
      enabled: true,
      turn: turn ?? gameState?.currentTurn,
      year: currentYear,
      corpsById: lookups.corpById,
      sectorsByCorp: advertisingSectorsByCorp,
      fxByCurrency: lookups.exchangeRatesByCurrency,
      deliveredAnchorBySellerId: advertisingDeliveredAnchorBySellerId,
      settledSpendAnchorByBuyerId: settledMarketingSpendAnchorByBuyerId,
    });
    mark("advertisingSettlement");
  }

  const settledPoliticalMediaOrders = [];
  const currentTurnNumber = turn ?? gameState?.currentTurn ?? 0;
  const plannedPoliticalUnitsBySectorId = new Map<string, number>();
  if (mediaProductSlatesEnabled) {
    for (const order of politicalMediaOrders) {
      const plan = order.settlementPlan ?? plannedPoliticalMediaOrders.get(order.orderId);
      if (plan?.plannedTurn !== currentTurnNumber) continue;
      for (const seller of plan.sellers) {
        plannedPoliticalUnitsBySectorId.set(
          seller.sectorId,
          (plannedPoliticalUnitsBySectorId.get(seller.sectorId) ?? 0) + seller.units
        );
      }
    }
  }
  const paidPoliticalSellerBySectorId = new Map<string, PaidPoliticalMediaSellerAmount>();
  if (politicalMediaMarketEnabled) {
    for (const order of politicalMediaOrders) {
      // New plans were already durably saved before sector P&L writes. The
      // loaded order is an opening snapshot, so do not issue the same plan
      // read/CAS a second time after bulk writes.
      if (!order.settlementPlan && !plannedPoliticalMediaOrders.has(order.orderId)) continue;
      const results = await settlePoliticalMediaOrder(db, order.orderId, turn ?? 0);
      const plan = order.settlementPlan ?? plannedPoliticalMediaOrders.get(order.orderId);
      if (mediaProductSlatesEnabled && plan?.plannedTurn === currentTurnNumber) {
        for (const seller of paidPoliticalMediaSellerReceipts({
          orderId: order.orderId,
          sellers: plan.sellers,
          results,
          orderAlreadySettled: order.status === "settled",
        })) {
          const prior = paidPoliticalSellerBySectorId.get(seller.sectorId) ?? {
            units: 0,
            amountAnchor: 0,
          };
          paidPoliticalSellerBySectorId.set(seller.sectorId, {
            units: prior.units + seller.units,
            amountAnchor: prior.amountAnchor + seller.amountAnchor,
          });
        }
      }
      const settled =
        order.status === "settled" ||
        (results.length > 0 &&
          results.every((result) => result.status === "applied" || result.status === "replayed"));
      if (settled && plan?.plannedTurn === (turn ?? gameState?.currentTurn ?? 0)) {
        settledPoliticalMediaOrders.push({
          orderId: order.orderId,
          status: "settled" as const,
          identity: order.identity,
          settlementPlan: plan,
        });
      }
      await applyPoliticalMediaOrderEffect(db, order.orderId);
    }
  }

  if (mediaProductSlatesEnabled && lookups.mediaProductProjectsBySectorId) {
    const basePrices = eraScaledBasePrices(lookups.eraUnitScale);
    const attributions: ReturnType<typeof attributeMediaProductSales> = [];
    const strategyIdBySectorId = new Map<string, string>();
    for (const sectors of lookups.sectorsByCorp.values()) {
      for (const sector of sectors) {
        if (typeof sector.strategyId === "string") {
          strategyIdBySectorId.set(sector._id.toString(), sector.strategyId);
        }
      }
    }
    for (const [sectorId, projects] of lookups.mediaProductProjectsBySectorId) {
      const clearing = market.clearingBySectorId?.get(sectorId);
      const strategyId = strategyIdBySectorId.get(sectorId);
      if (!clearing?.deliveredUnitsByCommodity || !strategyId) continue;
      const reconciled = reconcileMediaProductDelivery({
        clearing,
        plannedPoliticalUnits: plannedPoliticalUnitsBySectorId.get(sectorId) ?? 0,
        paidPoliticalSeller: paidPoliticalSellerBySectorId.get(sectorId) ?? {
          units: 0,
          amountAnchor: 0,
        },
      });
      attributions.push(
        ...attributeMediaProductSales({
          projects,
          clearing: reconciled.clearing,
          basePrices,
          turn: currentTurnNumber,
          strategyId,
          paidPoliticalUnitsByCommodity: reconciled.paidPoliticalUnitsByCommodity,
          paidPoliticalRevenueAnchorByCommodity: reconciled.paidPoliticalRevenueAnchorByCommodity,
        })
      );
    }
    await persistMediaProductSales(db, attributions);
  }

  if (mediaEditorialEnabled && mediaOperatingModelsEnabled && market.editorialOutletsByState) {
    const outletsByState = addSettledPoliticalAttention({
      commercialOutletsByState: new Map(
        [...market.editorialOutletsByState].map(([stateId, outlets]) => [
          stateId,
          outlets.map((outlet) => ({
            ...outlet,
            attentionUnits: outlet.attentionUnits ?? 0,
          })),
        ])
      ),
      settledOrders: settledPoliticalMediaOrders,
      stanceByCorporationId: new Map(
        [...lookups.corpById].map(([corporationId, corporation]) => [
          corporationId,
          {
            economic: corporation.editorialStance?.economic ?? 0,
            social: corporation.editorialStance?.social ?? 0,
          },
        ])
      ),
    });
    await applyMediaEditorialEffects({
      db,
      turn: turn ?? gameState?.currentTurn ?? 0,
      outletsByState,
    });
  }

  // Contracts and surveys read the post-bulkWrite snapshot so this turn's
  // mothball / production-policy / cash writes are visible. Matching before
  // the write would lock volume against a plant this pass just idled, and
  // a survey debit would lose to the reinvestment `$set liquidCapital`.
  await processNppSupplyAgreements(db, turn ?? 0, now, market.plantsEnabled);
  mark("nppSupplyAgreements");

  const nppProspects = await processNppProspecting(db, turn ?? 0, now);
  if (nppProspects > 0) mark("nppProspecting");

  const nppTreasury = await processNppCorpTreasury(db, turn ?? 0, now);
  if (nppTreasury > 0) mark("nppCorpTreasury");

  // Persist per-commodity output quality for next turn's input pillar (quality
  // propagation). Upsert by commodity so the lagged read above stays one turn behind.
  if (newCommodityQuality && newCommodityQuality.size > 0) {
    await db.collection("commodityQuality").bulkWrite(
      [...newCommodityQuality].map(([commodity, quality]) => ({
        updateOne: {
          filter: { commodity },
          update: { $set: { commodity, quality, turn: turn ?? 0, updatedAt: now } },
          upsert: true,
        },
      }))
    );
  }

  // Route the reduced FX spreads skimmed from foreign operating income into the
  // CB system (reserve slice → corp's home CB in the source currency; revenue →
  // source-currency CB). Already deducted from the corp's credited income above.
  await distributeConversionSpreadsBatch(db, sectorFxSpreadFees);

  // v3 Phase 6: translate this turn's strike trigger/resolution events into
  // sentiment pulses. Fired after the bulk writes above, on the now-persisted
  // state, same as every other side effect in this function.
  for (const { sectorType, countryId, event } of strikeEvents) {
    if (event === "started") {
      await fireStrikeStartedPulse(db, sectorType, countryId);
    } else {
      await fireStrikeResolvedPulse(db, sectorType, countryId);
    }
  }

  // Notify player-owned extraction sectors that newly hit a capacity ceiling
  // this turn, their realized resource revenue is now being throttled by the
  // capacity haircut, so the CEO should acquire capacity, adopt a focused
  // extraction strategy, or expand elsewhere. Skips NPP/natcorp-run sectors.
  if (capacityBindingEvents.length > 0) {
    const capacityNotifications = capacityBindingEvents.flatMap((ev) => {
      const corp = lookups.corpById.get(ev.corporationId);
      if (!corp?.userId || corp.countryOwnerId) return [];
      const resourceLabel = COMMODITY_LABELS[ev.bindingResource];
      return [
        {
          userId: corp.userId,
          type: "extraction_capacity_bound" as const,
          title: `Extraction capacity limit: ${resourceLabel}`,
          message:
            `Your extraction operations in ${ev.stateId} are constrained to ` +
            `${Math.round(ev.utilization * 100)}% of potential output by ${resourceLabel} ` +
            `capacity. Realized resource revenue is being throttled, acquire capacity, ` +
            `adopt a focused extraction strategy, or expand into states with headroom.`,
          metadata: {
            corporationId: ev.corporationId,
            sectorId: ev.sectorId,
            stateId: ev.stateId,
            resource: ev.bindingResource,
            utilizationPercent: Math.round(ev.utilization * 100),
            turn,
          },
        },
      ];
    });
    if (capacityNotifications.length > 0) {
      await createNotifications(capacityNotifications);
    }
  }

  // Insert any new NPP sectors.
  //
  // PLANTS-GATED: write half of the founding insert whose document half lives
  // in `nppCorporationBehavior.buildNppSectorDocs`. Docs carry `revenue`, so
  // this is a registered `corporateSectors.revenue` writer, see
  // `sectorRevenueWriters.guard.test.ts`. Under plants that figure is the legacy nameplate only; `sectorTurn`
  // restates `revenue` from capacity next tick. Below plants the nameplate is
  // the operative figure. The quantity that matters is written by the builder,
  // not here.
  if (nppNewSectors.length > 0) {
    await db.collection("corporateSectors").insertMany(nppNewSectors);
  }

  // Business Acumen use-growth: each turn, every active player CEO accrues
  // Business Acumen XP (flushed by the action-refresh phase). Mirrors how
  // legislative play trains Statecraft. The increment scales with the corp's
  // realized profit margin this turn, a better-run corp teaches more, and a CEO
  // running several corps is credited for their most successful one.
  // NPP/imperial/vacant CEOs are excluded.
  const ceoBestMarginById = new Map<string, { id: ObjectId; margin: number }>();
  for (const corp of lookups.corporations) {
    if (corp.ceoId && !corp.ceoVacant && (corp.ceoType === "character" || corp.ceoType == null)) {
      const key = corp.ceoId.toString();
      const margin = profitMarginByCorpId.get(corp._id.toString()) ?? 0;
      const prev = ceoBestMarginById.get(key);
      if (!prev || margin > prev.margin) {
        ceoBestMarginById.set(key, { id: corp.ceoId, margin });
      }
    }
  }
  if (ceoBestMarginById.size > 0) {
    await db.collection<Character>("characters").bulkWrite(
      [...ceoBestMarginById.values()].map(({ id, margin }) => ({
        updateOne: {
          filter: { _id: id, stats: { $exists: true } },
          update: {
            $inc: {
              "statXp.businessAcumen":
                USE_GROWTH_INCREMENT * businessAcumenGrowthMultiplier(margin),
            },
          },
        },
      }))
    );
  }

  // Phase 3a/3a': SOE loss backing plus profit remittance (spec §11.1/§11.2,
  // spec P6g §5.1), folded into snapshots before history persistence. See
  // runSoeBackingSweep: runs after sector/corp writes so liquidCapital
  // reflects this turn's result, within the corp turn so metric writes
  // precede the late state-metrics phase.
  mark("acumen+fxSpread+newSectors");
  const soeSweepAudit = await runSoeBackingSweep({
    db,
    now,
    turn: turn ?? gameState?.currentTurn,
    currentYear,
    corpSnapshots,
    corpById: lookups.corpById,
    mark,
  });
  if (soeSweepAudit) corpAuditEntries.push(soeSweepAudit);

  // Phase 3b: R&D innovation, every 6 turns, corps with accumulated R&D score
  // have a chance to boost a sector's revenue. Extraction corps also boost state
  // resource capacity. Runs after base sector writes so the $inc is additive.
  if (typeof turn === "number" && turn % 6 === 0) {
    const { sectorBoostOps, capacityBoostOps, innovationsTriggered } = processRdInnovations(
      lookups,
      turn,
      now,
      makeSeededRng(`rdInnovation:${turn}${CORP_TURN_RNG_SALT}`),
      market.plantsEnabled
    );
    if (sectorBoostOps.length > 0) {
      // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing, runtime shape is valid
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.collection("corporateSectors").bulkWrite(sectorBoostOps as any[]);
    }
    if (capacityBoostOps.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.collection("stateResourceCapacity").bulkWrite(capacityBoostOps as any[]);
    }
    if (innovationsTriggered > 0) {
      console.log(
        `[corp-turn] R&D innovations: ${innovationsTriggered} breakthrough(s) on turn ${turn}`
      );
    }
  }

  // Phase 3c-fund: Constituent corp dividends to index funds (75% reinvest / 25% pass-through).
  //
  // This was the single dominant cost of the whole corporationTurn phase (~4.5s
  // of ~5s at 8 countries, measured via SIM_CORP_TIMING), ~500 (fund,corp)
  // accruals per turn, each `processIndexFundDividend` doing ~10 sequential DB
  // round-trips, run one-after-another = ~5,000 serial round-trips. It scales
  // with corp count, so at the 30-50-country target it would balloon.
  //
  // Fixed two ways without changing behavior: (1) pass the turn we already hold
  // so each call skips a redundant getCurrentTurn findOne; (2) group accruals by
  // fund and run the fund groups CONCURRENTLY (bounded by the driver pool) while
  // keeping each fund's own accruals sequential, same-fund accruals touch the
  // same fund cash/positions, so serializing within a fund preserves exact
  // ordering + per-corporation tx-log granularity, while the ~32 independent
  // funds overlap. Per-corp dividend attribution is unchanged.
  mark("rdInnovations");
  if (fundDividendAccruals.length > 0) {
    const { isIndexFundsEnabled } = await import("@/lib/indexFunds/featureFlag");
    if (await isIndexFundsEnabled()) {
      // I/O batching. This step is ~42% of corporationTurn, dominated by ~5k
      // serial DB round-trips/turn against prod's remote Mongo.
      // processIndexFundDividendsBatch collapses them into a handful of bulk
      // ops. It shipped off by default pending evidence it was equivalent;
      // that evidence now exists, so it is on.
      //
      // Equivalence is proved two ways. scripts/perf/dividend-equivalence.ts
      // runs both paths over identical real state and diffs all six written
      // collections, including adversarial input (repeated fund/corp keys that
      // must sum, sub-cent amounts that floor away individually, NaN/Infinity/
      // negative amounts, zero and negative share counts).
      //
      // Measured at 500 accruals: 4,513 Mongo round trips collapse to 110, a
      // 41x reduction. Wall clock is not the number to quote — on a local
      // mongod a round trip is ~0.05ms, so the whole saving disappears into
      // turn-to-turn noise there. Against production's remote Mongo the same
      // 4,403 saved round trips are worth roughly 4s at 1ms RTT and 13s at
      // 3ms.
      //
      // The two paths are NOT bit-identical and cannot be: N separate `$inc`s
      // accumulate in a different order than one pre-summed `$inc`, and double
      // addition is not associative. Measured worst drift is 1.5e-8 absolute /
      // 3e-15 relative, i.e. a hundred-millionth of one anchor unit, which is
      // six orders of magnitude below the cent that flooring already discards.
      // The unit tests in dividendPassThrough.test.ts pin the aggregation
      // arithmetic that result rests on so CI keeps it honest.
      //
      // Set AHD_BATCH_FUND_DIVIDENDS=off to fall back to the per-accrual path
      // without a deploy, should a discrepancy ever surface in production.
      if (process.env.AHD_BATCH_FUND_DIVIDENDS !== "off") {
        const { processIndexFundDividendsBatch } =
          await import("@/lib/indexFunds/dividendPassThrough");
        try {
          await processIndexFundDividendsBatch(db, fundDividendAccruals, {
            turn: typeof turn === "number" ? turn : undefined,
          });
        } catch (err) {
          console.warn("[corp-turn] Batched index-fund dividend pass-through failed:", err);
        }
      } else {
        const { processIndexFundDividend } = await import("@/lib/indexFunds/dividendPassThrough");
        const { getFundById, listFundPositions } = await import("@/lib/indexFunds/fundQueries");
        type FundDividendPrefetch = NonNullable<
          NonNullable<Parameters<typeof processIndexFundDividend>[5]>["prefetch"]
        >;
        const accrualsByFund = new Map<
          string,
          {
            fundId: (typeof fundDividendAccruals)[number]["fundId"];
            list: typeof fundDividendAccruals;
          }
        >();
        for (const accrual of fundDividendAccruals) {
          if (!Number.isFinite(accrual.amountAnchor) || accrual.amountAnchor <= 0) continue;
          const key = accrual.fundId.toString();
          const entry = accrualsByFund.get(key);
          if (entry) entry.list.push(accrual);
          else accrualsByFund.set(key, { fundId: accrual.fundId, list: [accrual] });
        }
        await Promise.all(
          [...accrualsByFund.values()].map(async ({ fundId, list }) => {
            // Read the fund + its unit-holder positions ONCE per fund, then reuse
            // across all of this fund's accruals, they're constant during
            // dividend processing (see processIndexFundDividend's prefetch doc).
            let prefetch: FundDividendPrefetch | undefined;
            try {
              const fund = await getFundById(db, fundId);
              if (fund) prefetch = { fund, positions: await listFundPositions(db, fundId) };
            } catch {
              prefetch = undefined; // fall back to per-call fetch on any read hiccup
            }
            for (const accrual of list) {
              try {
                await processIndexFundDividend(
                  db,
                  accrual.fundId,
                  accrual.amountAnchor,
                  accrual.corporationId,
                  accrual.shares,
                  { turn: typeof turn === "number" ? turn : undefined, prefetch }
                );
              } catch (err) {
                console.warn("[corp-turn] Index fund dividend pass-through failed:", {
                  fundId: accrual.fundId.toString(),
                  corporationId: accrual.corporationId.toString(),
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            }
          })
        );
      }
    }
  }

  mark("fundDividends");
  // Phase 3c: Credit dividends to corporate shareholders, see
  // creditCorpDividends (FX spread skim, 50% dividend-received deduction tax,
  // corp_dividend ledger rows, same-turn corporationHistory tax record).
  // Returns the per-corp dividend-received tax so the ledger emission below
  // can fold it into the per-country gov_tax_revenue totals.
  const { dividendTaxPaidByCountry, dividendIncomeReceivedByCorpId } = await creditCorpDividends({
    db,
    lookups,
    corpDividendPaymentsAnchorByCorpId,
    corpDividendPaymentsAnchorByCorpCurrency,
    turn,
    now,
    thresholds,
  });

  mark("corpDividends");
  // Phase 3c2: settle bilateral supply-agreement price premiums (contract-for-
  // difference) after operating income is on liquidCapital. Conserves cash: the
  // supplier is credited and the buyer debited the same ₳ premium delta.
  if (supplyAgreementsEnabled && settleableAgreements && settleableAgreements.length > 0) {
    try {
      const { settledCount, settledPremiums } = await settleSupplyAgreements({
        db,
        lookups,
        agreements: settleableAgreements,
        contractSettlementByCorp,
        buyerDemandByCorpCommodity,
        producedByCorpCommodity: market.plantsEnabled ? producedByCorpCommodity : undefined,
        achievableByCorpCommodity: market.plantsEnabled ? achievableByCorpCommodity : undefined,
        plantsEnabled: market.plantsEnabled,
        priceRatioByCommodity: lookups.priceRatioByCommodity,
        turn: turn ?? 0,
        now,
        thresholds,
      });
      if (settledCount > 0) {
        console.log(`[corporationTurn] settled ${settledCount} supply-agreement premium(s)`);
      }

      // C5: intra-group cross-border pricing. Runs off the same settled premiums
      // rather than re-deriving them, so what the tax authority sees is exactly
      // what the contract priced. Best-effort.
      if (settledPremiums.length > 0) {
        try {
          const { applyTransferPricingAudit } =
            await import("@/lib/corporations/groups/applyTransferPricingAudit");
          const tp = await applyTransferPricingAudit(
            db,
            settledPremiums,
            lookups.domesticCorpTaxRateByCountry,
            turn ?? 0,
            now
          );
          if (tp.auditsAssessed > 0) {
            console.log(
              `[corporationTurn] transfer pricing: ${tp.auditsAssessed} assessment(s), ₳${Math.round(tp.totalAssessedAnchor).toLocaleString()} across ${tp.positionsTracked} tracked position(s)`
            );
            corpAuditEntries.push({
              source: "turn",
              category: "corp",
              action: "corp.transfer_pricing_sweep",
              phase: "corporationTurn",
              subject: { type: "corpBatch", name: "transfer pricing sweep" },
              outcome: "ok",
              meta: {
                positionsTracked: tp.positionsTracked,
                auditsAssessed: tp.auditsAssessed,
                assessedAnchor: Math.round(tp.totalAssessedAnchor),
              },
            });
          }
          if (tp.errors.length > 0) {
            console.error("[corporationTurn] transfer pricing errors:", tp.errors.slice(0, 5));
          }
        } catch (err) {
          console.error("[corporationTurn] transfer pricing audit failed:", err);
        }
      }
    } catch (err) {
      console.error("[corporationTurn] supply-agreement settlement failed:", err);
    }
  }
  mark("supplyAgreementSettlement");
  // Phase 3d: IMF facility remittances (after operating income is written to liquidCapital).
  // WHY: Payment cap uses the same per-turn `income` as corp snapshots; cash moves rescued → IMF (USD).
  if (typeof turn === "number" && corpSnapshots.length > 0) {
    await processImfBailoutPayments(db, turn, corpSnapshots, lookups.corporations);
  }
  mark("imfBailout");

  // Phase 3e (C4): group loss relief. Runs AFTER tax has been charged and after
  // IMF remittances, so it reads the same per-corp figures the treasury
  // actually collected against. Implemented as a rebate rather than a
  // consolidated recomputation, arithmetically identical for the turn, and
  // additive instead of unpicking the per-corp tax the whole snapshot is
  // derived from. Best-effort: a hiccup must not fail the turn.
  if (typeof turn === "number" && corpSnapshots.length > 0) {
    try {
      const { applyGroupLossRelief } = await import("@/lib/corporations/groups/applyGroupRelief");
      const relief = await applyGroupLossRelief(
        db,
        corpSnapshots.map((snap) => ({
          corpId: snap.corpId,
          incomePreDividends: snap.incomePreDividends,
          federalTaxPaid: snap.federalTaxPaid,
          stateTaxPaid: snap.stateTaxPaid,
        })),
        turn,
        now
      );
      if (relief.corpsCredited > 0) {
        console.log(
          `[corporationTurn] group relief: ${relief.groupsRelieved} group(s), ${relief.corpsCredited} corp(s), ₳${Math.round(relief.totalReliefAnchor).toLocaleString()}`
        );
        corpAuditEntries.push({
          source: "turn",
          category: "corp",
          action: "corp.group_loss_relief",
          phase: "corporationTurn",
          subject: { type: "corpBatch", name: "group loss relief" },
          outcome: "ok",
          meta: {
            groups: relief.groupsRelieved,
            corps: relief.corpsCredited,
            reliefAnchor: Math.round(relief.totalReliefAnchor),
          },
        });
      }
      if (relief.errors.length > 0) {
        console.error("[corporationTurn] group relief errors:", relief.errors.slice(0, 5));
      }
    } catch (err) {
      console.error("[corporationTurn] group loss relief failed:", err);
    }
  }
  mark("groupLossRelief");

  // Phase 3f (C6): group operating synergies. A group's members converge toward
  // its best marketing and logistics capability, upward only, so acquiring a
  // weak subsidiary never drags a strong parent down. Best-effort.
  if (typeof turn === "number") {
    try {
      const { applyGroupSynergies } = await import("@/lib/corporations/groups/applySynergies");
      const synergies = await applyGroupSynergies(db, turn);
      if (synergies.corpsLifted > 0) {
        console.log(
          `[corporationTurn] group synergies: lifted ${synergies.corpsLifted} corp(s) across ${synergies.groupsProcessed} group(s)`
        );
      }
      if (synergies.errors.length > 0) {
        console.error("[corporationTurn] group synergy errors:", synergies.errors.slice(0, 5));
      }
    } catch (err) {
      console.error("[corporationTurn] group synergies failed:", err);
    }
  }
  mark("groupSynergies");

  // Phase 4 (+4b diagnostic): Update domestic/foreign corporate profits tax
  // bases (75% GDP-derived floor + 25% actual annualised corp income), see
  // updateCorporateTaxBases for the currency convention (v0.2.6 locked
  // decision #3) and the per-turn income-split diagnostic log.
  await updateCorporateTaxBases({
    db,
    lookups,
    domesticIncomeByCountry,
    foreignIncomeByCountry,
    domesticIncomeByOperatingState,
    foreignIncomeByOperatingState,
  });

  // O1c (design §5): persist paid growth investment per operating state, turn-
  // tagged so the metric engine only counts THIS turn's flow (fresh-or-zero).
  // Stored in ₳; the metric engine converts + caps. Gated on macroGrowthV1 so a
  // flag-off world pays no extra per-turn state write (the feature is off by
  // default).
  if (gameState?.macroGrowthV1 === true && growthInvestmentByOperatingState.size > 0) {
    const investTurn = turn ?? 0;
    const stateInvestOps = Array.from(growthInvestmentByOperatingState, ([stateId, anchor]) => ({
      updateOne: {
        filter: { _id: stateId },
        update: {
          $set: { corpGrowthInvestmentAnchor: anchor, corpGrowthInvestmentTurn: investTurn },
        },
      },
    }));
    await db.collection<State>("states").bulkWrite(stateInvestOps);
  }

  mark("taxBases(fed+state)");
  // Phase 5: Refresh national budget revenue (public-enterprise corps feed back into budgets)
  await refreshNationalBudgetRevenue(db);
  mark("refreshNationalBudget");

  // Phase 6: Pay CEO salaries + dividends to characters' personal balance
  // (in the corporation's country currency for proper forex support)
  // Split payments: keys prefixed with "imperial:" go to imperialCharacters collection
  // keys prefixed with "npp:" go to npps collection
  const charPayments = new Map<string, Map<CurrencyCode, number>>();
  const imperialPayments = new Map<string, Map<CurrencyCode, number>>();
  const nppPayments = new Map<string, Map<CurrencyCode, number>>();

  for (const paymentMap of [ceoSalaryPayments, dividendPayments]) {
    for (const [id, currMap] of paymentMap) {
      const isImperial = id.startsWith("imperial:");
      const isNpp = id.startsWith("npp:");
      const cleanId = isImperial
        ? id.slice("imperial:".length)
        : isNpp
          ? id.slice("npp:".length)
          : id;
      const targetMap = isImperial ? imperialPayments : isNpp ? nppPayments : charPayments;

      if (!targetMap.has(cleanId)) targetMap.set(cleanId, new Map());
      const merged = targetMap.get(cleanId)!;
      for (const [currency, amount] of currMap) {
        merged.set(currency, (merged.get(currency) ?? 0) + amount);
      }
    }
  }

  const currencyIncomeFaceByCharacterId = new Map<string, Map<CurrencyCode, number>>();
  for (const [id, currMap] of charPayments) {
    currencyIncomeFaceByCharacterId.set(id, new Map(currMap));
  }
  mark("paymentAggregation");
  const ratesForLoc = await loadExchangeRatesMap(db);
  const currencyIncomeInternalByCharacterId = new Map<string, number>();
  for (const [charIdStr, currencyAmounts] of charPayments) {
    let internal = 0;
    for (const [currency, amount] of currencyAmounts) {
      if (amount <= 0) continue;
      const rate = ratesForLoc[currency];
      if (!rate || rate <= 0) continue;
      internal += toInternalUnits(amount, rate);
    }
    if (internal > 0) currencyIncomeInternalByCharacterId.set(charIdStr, internal);
  }

  // Phase 6 (pre-write): garnish CEO salary + dividend income for distressed
  // LOC borrowers BEFORE the wallet credit. `garnishLocFromIncome` mutates
  // `charPayments` to remove or scale down redirected entries; the bulkWrite
  // below then only credits whatever survived (typically zero for distressed
  // borrowers, since their LOC obligation dwarfs one turn of income).
  // Recomputes income totals so dividends already redirected don't double-feed
  // the LOC composite via Phase 6a forex auto-convert.
  if (charPayments.size > 0 && typeof turn === "number") {
    await garnishLocFromIncome(db, charPayments, turn, "ceo_dividend", {
      auxiliaryPayments: [dividendPayments],
    });
  }

  if (charPayments.size > 0) {
    const charOps: AnyBulkWriteOperation<Character>[] = [];
    for (const [charIdStr, currencyAmounts] of charPayments) {
      for (const [currency, amount] of currencyAmounts) {
        charOps.push(
          buildPersonalBalanceBulkOp(
            new ObjectId(charIdStr),
            amount,
            currency,
            forexEnabled
          ) as AnyBulkWriteOperation<Character>
        );
      }
    }
    if (charOps.length > 0) await db.collection<Character>("characters").bulkWrite(charOps);
  }
  mark("garnish+charPayments");

  if (imperialPayments.size > 0) {
    const imperialOps: AnyBulkWriteOperation[] = [];
    for (const [imperialIdStr, currencyAmounts] of imperialPayments) {
      for (const [currency, amount] of currencyAmounts) {
        imperialOps.push(
          buildPersonalBalanceBulkOp(new ObjectId(imperialIdStr), amount, currency, forexEnabled)
        );
      }
    }
    await db.collection("imperialCharacters").bulkWrite(imperialOps);
  }

  // Phase 6b: Credit NPP CEO salaries and dividends to the NPP's PERSONAL wealth
  // (currencyBalances.personal, per corp currency), mirroring the player path in
  // Phase 6. Dividend/CEO income is OWNERSHIP income and belongs to personal net
  // worth, which the balance metric measures; the campaign war chest (`funds`,
  // topped up by nppFundGeneration) is operating capital and is deliberately
  // excluded from wealth. Previously this credited `funds`, so NPP ownership
  // income vanished into the wealth-excluded campaign account and measured NPP
  // wealth read as flat regardless of who owned what. NPPs now carry
  // currencyBalances (npp.ts), processed by the savings/portfolio phases.
  if (nppPayments.size > 0) {
    const nppOps: AnyBulkWriteOperation[] = [];
    for (const [nppIdStr, currencyAmounts] of nppPayments) {
      const inc: Record<string, number> = {};
      for (const [currency, amount] of currencyAmounts) {
        if (amount > 0) {
          inc[`currencyBalances.personal.${currency}`] = Math.round(amount);
        }
      }
      if (Object.keys(inc).length > 0) {
        nppOps.push({
          updateOne: {
            filter: { _id: new ObjectId(nppIdStr) },
            update: { $inc: inc },
          },
        });
      }
    }
    if (nppOps.length > 0) {
      await db.collection("npps").bulkWrite(nppOps);
    }
  }
  mark("imperial+nppPayments");

  // Phase 6a: Auto-convert dividend income back to each holder's home currency.
  // One `executeMarketMakerTrade` per (character, foreign currency), dividends paid
  // this turn across all corps in that currency are aggregated into a single trade,
  // which contributes to forex volume/pressure for the involved currency pair.
  // Gated on forexEnabled; CEO salary is left in the paying corp's currency by design.
  // Note: only processes regular character dividends; imperial dividends use the
  // "imperial:" prefix convention and were already separated into imperialPayments above.
  if (forexEnabled && dividendPayments.size > 0 && typeof turn === "number") {
    // Filter to only non-imperial, non-npp dividend entries
    const divCharIds = [...dividendPayments.keys()]
      .filter((id) => !id.startsWith("imperial:") && !id.startsWith("npp:"))
      .map((id) => new ObjectId(id));
    const divChars =
      divCharIds.length > 0
        ? await db
            .collection<Character>("characters")
            .find({ _id: { $in: divCharIds } })
            .toArray()
        : [];
    const charById = new Map(divChars.map((c) => [c._id.toString(), c]));
    const quoteContext = await loadConversionQuoteContext(db, gameState?.euroMonetaryUnion);

    for (const [charIdStr, currMap] of dividendPayments) {
      if (charIdStr.startsWith("imperial:") || charIdStr.startsWith("npp:")) continue;
      const char = charById.get(charIdStr);
      if (!char) continue;
      const homeCurrency = getHomeCurrency(char);
      for (const [currency, amount] of currMap) {
        if (currency === homeCurrency || amount <= 0) continue;
        await executeMarketMakerTrade(db, {
          characterId: char._id,
          countryId: char.countryId as CountryId,
          fromCurrency: currency,
          toCurrency: homeCurrency,
          amount,
          turn,
          source: "auto_dividend",
          quoteContext,
        });
      }
    }
  }

  mark("marketMakerDividendConv");
  // Phase 7: Fill pending share orders based on updated share prices.
  // `turn ?? 0`, turn is optional on this function's signature, but it's always
  // set by the hourly cron; the fallback keeps ad-hoc callers (tests) working.
  await fillPendingShareOrders(db, now, turn ?? 0);

  // Phase 7a: Expire share listings and refund pending offers
  await expireShareListings(db, now, turn ?? 0);
  mark("fillOrders+expireListings");

  // Phase 8: Snapshot market cap history + per-corp history + credit change notifications
  if (typeof turn === "number") {
    await snapshotMarketCap(
      db,
      turn,
      lookups.corporations,
      corpSnapshots,
      lookups.corpById,
      lookups.exchangeRatesByCurrency,
      now,
      makeSeededRng(`marketCapCandle:${turn}${CORP_TURN_RNG_SALT}`),
      dividendIncomeReceivedByCorpId,
      dividendTaxPaidByCountry
    );
  }
  mark("snapshotMarketCap");

  // Emit corp_revenue / corp_tax_paid (per corp), corp_salary / corp_dividend
  // (per character) and gov_tax_revenue (per country) ledger rows, see
  // emitCorporationTurnTx for the Phase-3 split rationale and tax fold-in.
  await emitCorporationTurnTx({
    db,
    lookups,
    corpSnapshots,
    ceoSalaryPayments,
    dividendPayments,
    dividendTaxPaidByCountry,
    turn,
    now,
    thresholds,
  });
  mark("emitTx(revenue/salary/tax)");

  // Phase 9: Auto-finalize due/certain shareholder votes, then send closing reminders.
  if (typeof turn === "number") {
    // Await the resolver so vote effects are part of the completed corporation turn.
    await processVoteAutoResolve(db, turn, forexEnabled);
    void processVoteReminders(db, turn);
    mark("voteAutoResolve");
    // Resolve nationalizations whose notice window has elapsed (spec §14): cure-cancel
    // or complete the taking. Awaited so its effects land within this corp turn.
    await processPendingNationalizations(db, turn);
    // Resolve privatization auctions whose bid window has closed (spec §13.3):
    // sell to the top bidder or re-absorb the unsold carve-out.
    await processNationalizationAuctions(db, turn);
    mark("nationalizations");

    // Financial-distress clock for the executive-nationalization grace window.
    // Runs last, after pending takings may have removed seized corps and all
    // liquidCapital writes have settled, so it reads each surviving player corp's
    // post-turn cash. Best-effort: a hiccup must not fail the turn.
    try {
      await trackFinancialDistress(db, turn);
    } catch (err) {
      logger.error("corporationTurn", "financial-distress tracking failed", err);
    }
    mark("financialDistress");

    // Subsidiary corporations (feature-gated, dynamic import to avoid circular
    // deps): clear the formalization marker + dividend-floor fields on any corp
    // whose controlling parent has slipped below 50% voting power. Derived-model
    // equivalent of auto-dissolution; no synergy work. Best-effort.
    if (subsidiaryCorporationsEnabled) {
      try {
        const { cleanupZombieSubsidiaries } =
          await import("@/lib/corporations/subsidiaries/turnCleanup");
        const cleared = await cleanupZombieSubsidiaries(db, lookups.corporations, now);
        if (cleared > 0) {
          console.log(`[corporationTurn] cleared ${cleared} zombie subsidiary marker(s)/floor(s)`);
          corpAuditEntries.push({
            source: "turn",
            category: "corp",
            action: "corp.subsidiary_cleanup",
            phase: "corporationTurn",
            subject: { type: "corpBatch", name: "zombie subsidiary cleanup" },
            outcome: "ok",
            meta: { count: cleared },
          });
        }
      } catch (err) {
        console.error("[corporationTurn] subsidiary cleanup failed:", err);
      }
    }

    // Merger review (C3): decide every referral whose deadline has passed on the
    // published bands, then fine any corporation still sitting on an overdue
    // divestiture order. Runs after subsidiary cleanup so the controlled-group
    // measurement reads settled ownership. Best-effort: a hiccup must not fail
    // the turn.
    mark("subsidiaryCleanup");
    try {
      const { resolveDueMergerReviews, fineOverdueDivestitures } =
        await import("@/lib/corporations/mergerReview/lifecycle");
      const { resolved } = await resolveDueMergerReviews(db, turn);
      const { fined, totalAnchor } = await fineOverdueDivestitures(db, turn);
      if (resolved > 0 || fined > 0) {
        console.log(
          `[corporationTurn] merger review: ${resolved} referral(s) resolved on deadline, ${fined} overdue divestiture(s) fined`
        );
        corpAuditEntries.push({
          source: "turn",
          category: "corp",
          action: "corp.merger_review_sweep",
          phase: "corporationTurn",
          subject: { type: "corpBatch", name: "merger review sweep" },
          outcome: "ok",
          meta: { resolved, fined, finesAnchor: totalAnchor },
        });
      }
    } catch (err) {
      console.error("[corporationTurn] merger review sweep failed:", err);
    }

    // NPP-corp bankruptcy exit: player corps get nationalized/dissolved when
    // they fail, but NPP corps had no such exit and bled to arbitrarily
    // negative liquidCapital forever. Wind down the terminally-insolvent ones
    // (see nppInsolvencyDissolution.ts). Runs after distress tracking so it
    // reads the same post-turn cash. Best-effort.
    mark("mergerReview");
    try {
      const { processNppInsolventCorpDissolution } =
        await import("@/lib/turn/corporation/nppInsolvencyDissolution");
      const dissolveResult = await processNppInsolventCorpDissolution(db, turn);
      if (dissolveResult.dissolved > 0) {
        console.log(
          `[corporationTurn] auto-dissolved ${dissolveResult.dissolved}/${dissolveResult.candidates} terminally-insolvent NPP corp(s)`
        );
      }
    } catch (err) {
      logger.error("corporationTurn", "NPP insolvency dissolution failed", err);
    }
  }
  mark("nppInsolvencyDissolution");

  // One bulk write for the whole turn's aggregate corp-audit entries, never
  // per-corp (perf guard, see comment above `corpAuditEntries`).
  if (corpAuditEntries.length > 0) {
    recordAuditBulk(corpAuditEntries);
  }

  timer.finish(turn);

  return {
    corporationsProcessed: lookups.corporations.length,
    sectorsProcessed,
    totalRevenueGenerated: Math.round(totalRevenueGenerated),
    totalIncomeGenerated: Math.round(totalIncomeGenerated),
    currencyIncomeInternalByCharacterId,
    currencyIncomeFaceByCharacterId,
    // Clearing book invariant breaches (issue #2054) for the turn warning
    // channel. Empty unless market clearing ran and a book breached.
    turnWarnings: clearingInvariantBreaches,
  };
}
