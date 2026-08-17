import { ObjectId } from "mongodb";
import type { AnyBulkWriteOperation } from "mongodb";
import type { Character } from "@/lib/db/types";
import type { State } from "@/lib/db/types/state";
import type { GameConfig } from "@/lib/db/types/gameConfig";
import { getDb } from "@/lib/mongodb";
import { refreshNationalBudgetRevenue } from "@/lib/budget/revenue";
import { buildCorporationLookups } from "./buildLookups";
import { USE_GROWTH_INCREMENT, businessAcumenGrowthMultiplier } from "@/lib/stats/statsConstants";
import { shedVacantCeoSectorsToUnowned } from "./vacantCeoSectorShed";
import { shedInactiveCeoSectorsToUnowned } from "./inactiveCeoSectorShed";
import { installCaretakersForVacantCorps } from "./autoCaretakerVacantCorps";
import { processSectors } from "./sectorCalculations";
import { getLabourSystemMode, labourAtLeast } from "@/lib/labour/featureFlag";
import { getMarketSystemMode, marketAtLeast } from "@/lib/market/featureFlag";
import { buildMarketContext } from "@/lib/market/marketContext";
import { computeClearingFactors, type SectorClearingInput } from "@/lib/market/clearing";
import { computeBrandLoyaltyUpdates, type LoyaltySectorInput } from "./brandLoyaltyTurn";
import { computeQualityUpdates } from "./brandQualityTurn";
import {
  getEffectiveStrategyRates,
  applyPlannedEconomyOutputMix,
  plannedEconomyMediaSupplyFactor,
} from "@/lib/constants/sectorStrategies";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import {
  eraScaledBasePrices,
  commodityMixWeight,
  embargoSupplyFactorFor,
  plantsSupplyScaledUnits,
} from "@/lib/constants/commodities";
import { clampAgreementPremium } from "@/lib/db/types/supplyAgreement";
import { settleSupplyAgreements, type SettleableSupplyAgreement } from "./settleSupplyAgreements";
import type { SupplyAgreement } from "@/lib/db/types/supplyAgreement";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  buildMinWageRatioByCountry,
  buildUnionLawBiasByCountry,
  buildUnionsBannedByCountry,
  type LabourContext,
} from "@/lib/labour/laborCost";
import { buildUnionEffectsById } from "@/lib/unions/unionLookups";
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
import { executeMarketMakerTrade, distributeConversionSpread } from "@/lib/currency/marketMaker";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  fxRateForCorpFromMap,
  resolveCorpLiquidCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { loadExchangeRatesMap } from "@/lib/lineOfCredit/netWorth";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { toInternalUnits } from "@/lib/lineOfCredit/locMath";
import { garnishLocFromIncome } from "@/lib/lineOfCredit/garnishment";
import { loadTxThresholds } from "@/lib/financialTxLog/emit";
import { processSoeOperations } from "@/lib/nationalization/soeOperations";
import { processSoeRemittance } from "@/lib/nationalization/soeRemittance";
import { processPendingNationalizations } from "@/lib/nationalization/pendingNationalizations";
import { processNationalizationAuctions } from "@/lib/nationalization/privatizationAuction";
import { processNppCorporationDecisions } from "@/lib/turn/nppCorporationBehavior";
import { processNppSupplyAgreements } from "@/lib/turn/npp/nppSupplyAgreements";
import { processNppProspecting } from "@/lib/turn/npp/nppProspecting";
import { processNppCorpTreasury } from "@/lib/turn/npp/nppCorpTreasury";
import { createNotifications } from "@/lib/notifications";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import { trackFinancialDistress } from "./financialDistressTracking";
import {
  persistLabourIndices,
  creditCorpDividends,
  updateCorporateTaxBases,
  emitCorporationTurnTx,
} from "./corporationTurnPhases";
import { getGameState } from "@/lib/gameState";
import { makeSeededRng } from "@/lib/events/substrate/rng";
import { logger } from "../../observability/logger";
import { recordAuditBulk } from "@/lib/audit/recordAudit";
import type { ActionAuditInput } from "@/lib/db/types/actionAuditLog";

// Optional sim-run salt, same convention as nppActionProcessing.ts's RNG.
const CORP_TURN_RNG_SALT = process.env.SIM_RNG_SALT ? `:${process.env.SIM_RNG_SALT}` : "";

export interface CorporationTurnResult {
  corporationsProcessed: number;
  sectorsProcessed: number;
  totalRevenueGenerated: number;
  totalIncomeGenerated: number;
  /** CEO salary + shareholder dividends this turn, internal units (for LOC cap / scoring). */
  currencyIncomeInternalByCharacterId: Map<string, number>;
  /** Same income as credited to personal, per currency (for LOC repayment allocation). */
  currencyIncomeFaceByCharacterId: Map<string, Map<CurrencyCode, number>>;
}

/**
 * Process all corporations each turn:
 * 1. Build lookup maps from DB
 * 1b. Vacant-CEO and inactive-CEO (user offline >72 turns) corps shed 10% of each sector's revenue/workers back to unowned markets
 * 2. Process all sectors (revenue, margin modifiers, share price, credit)
 * 3. Bulk write sector + corp updates
 * 4. Update corporate profit tax bases in federal + state budgets
 * 5. Refresh national budget revenue (public-enterprise corps)
 * 6. Pay CEO salaries + dividends to characters
 * 7. Fill pending share orders
 * 8. Snapshot market cap + per-corp history
 */
export async function processCorporationTurn(turn?: number): Promise<CorporationTurnResult> {
  const db = await getDb();
  const now = new Date();

  // Env-gated sub-step timing (SIM_CORP_TIMING=1). Zero-cost when off, used to
  // profile which of this phase's ~30 sequential steps actually dominate the
  // wall clock, so optimization targets real cost, not guesses. Emits one JSON
  // line per turn that a harness/analysis script can parse.
  const timingOn = process.env.SIM_CORP_TIMING === "1";
  const timings: Array<[string, number]> = [];
  let _tPrev = timingOn ? Date.now() : 0;
  const mark = (label: string): void => {
    if (!timingOn) return;
    const nowMs = Date.now();
    timings.push([label, nowMs - _tPrev]);
    _tPrev = nowMs;
  };

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
          marketGovernorCap: 1,
          marketGovernorRampTurns: 1,
          brandLoyaltyEnabled: 1,
          brandLoyaltySliceEnabled: 1,
          sectorQualityEnabled: 1,
          qualityPremiumPricingEnabled: 1,
          supplyAgreementsEnabled: 1,
          prospectingEnabled: 1,
          commandEconomyEnabled: 1,
          privateBankingEnabled: 1,
          interstateMoneyWiringEnabled: 1,
          freightSettlementMode: 1,
        },
      }
    ),
    getGameState(),
    getLabourSystemMode(),
  ]);
  mark("preamble");
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
  const lookups = await buildCorporationLookups(db, {
    plantsEnabled: plantsEnabledForMarketShare,
    freightSettlementActive,
    moneyWiringEnabled: interstateMoneyWiringEnabled,
  });
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
  const subsidiaryCorporationsEnabled = await isSubsidiaryCorporationsEnabled(
    gameState ?? undefined
  );
  mark("buildLookups+gameState");

  // Labour/Unions system: when labourSystemMode ≥ "wages", sector profit carves
  // an explicit, per-sector/per-era labor cost out of maintenance (resolved per
  // sector inside processSectors from sectorType + currentYear). Inert (no
  // economic change) when the mode is off, the default.
  const fullEnabled = labourAtLeast(labourMode, "full");
  const [unionsById, collectiveAgreementEffects, industrialActionOutputFactorBySectorId] =
    fullEnabled
      ? await Promise.all([
          buildUnionEffectsById(db),
          loadCollectiveAgreementEffects(db, turn ?? gameState?.currentTurn ?? 0),
          loadIndustrialActionOutputFactors(db),
        ])
      : [undefined, undefined, undefined];
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
    unionsBannedByCountry: buildUnionsBannedByCountry(lookups.federalBudgets),
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
  // Exclusive ⇒ the whole (capped) contract; otherwise min(cap, output) is
  // resolved against actual output inside clearing.
  let contractedByCorpCommodity: Map<string, Map<CommodityType, number>> | undefined;
  let exclusiveByCorpCommodity: Set<string> | undefined;
  let settleableAgreements: SettleableSupplyAgreement[] | undefined;
  // Populated during clearing: supplier corpId → commodity → contracted units that
  // actually cleared this turn. Drives the post-clearing premium settlement.
  const contractSettlementByCorp = new Map<string, Map<CommodityType, number>>();
  // Plants tier: supplier corpId → commodity → units actually produced this
  // turn (the offered book under plants IS real production). Drives the
  // supply-agreement shortfall penalty, a contract is a promise about goods,
  // so under-PRODUCING against it is the breach, not under-selling it.
  const producedByCorpCommodity = new Map<string, Map<CommodityType, number>>();
  if (supplyAgreementsEnabled) {
    contractedByCorpCommodity = new Map();
    exclusiveByCorpCommodity = new Set();
    settleableAgreements = [];
    // C6: a contract under NOTICE keeps delivering and settling until its
    // effective turn. Retire the ones whose notice has run out first, then load
    // everything still live. Ordering matters, a contract that expires this
    // turn must not settle again.
    await db
      .collection("supplyAgreements")
      .updateMany(
        { status: "cancelling", cancelEffectiveTurn: { $lte: turn ?? 0 } },
        { $set: { status: "cancelled", updatedAt: now } }
      );
    const agreements = await db
      .collection("supplyAgreements")
      .find(
        { status: { $in: ["active", "cancelling"] } },
        {
          projection: {
            supplierCorpId: 1,
            buyerCorpId: 1,
            commodity: 1,
            volumeCap: 1,
            pricePremium: 1,
            exclusive: 1,
            volumeCapBasis: 1,
          },
        }
      )
      .toArray();
    for (const a of agreements as unknown as {
      _id: ObjectId;
      supplierCorpId: ObjectId;
      buyerCorpId: ObjectId;
      commodity: CommodityType;
      volumeCap: number;
      pricePremium?: number;
      exclusive?: boolean;
      volumeCapBasis?: SupplyAgreement["volumeCapBasis"];
    }[]) {
      const corpId = a.supplierCorpId.toString();
      const cap = Math.max(0, a.volumeCap ?? 0);
      const byCommodity = contractedByCorpCommodity.get(corpId) ?? new Map<CommodityType, number>();
      byCommodity.set(a.commodity, (byCommodity.get(a.commodity) ?? 0) + cap);
      contractedByCorpCommodity.set(corpId, byCommodity);
      if (a.exclusive) exclusiveByCorpCommodity.add(`${corpId}:${a.commodity}`);
      settleableAgreements.push({
        agreementId: a._id?.toString(),
        supplierCorpId: corpId,
        buyerCorpId: a.buyerCorpId.toString(),
        commodity: a.commodity,
        volumeCap: cap,
        pricePremium: clampAgreementPremium(a.pricePremium ?? 0),
        // Shortfall damages only apply to contracts whose `volumeCap` was
        // checked against scaled plant capacity when it was signed. Contracts
        // predating that check carry no basis, so they settle their price
        // premium as usual and are grandfathered out of the damages leg, see
        // the stamp in corporations/commands/supplyAgreements.
        shortfallEligible: a.volumeCapBasis === "scaledCapacity",
      });
    }
  }
  // The slice (A2b) only bites when BOTH the master flag and the slice gate are
  // on, accrual can run shadow (A1/A2) with the slice still off.
  const brandLoyaltySliceEnabled =
    brandLoyaltyEnabled && marketGovernorConfig?.brandLoyaltySliceEnabled === true;
  const market = buildMarketContext(marketSystemMode, {
    cap: marketGovernorConfig?.marketGovernorCap,
    rampTurns: marketGovernorConfig?.marketGovernorRampTurns,
  });
  // Brand loyalty (A2, shadow-safe): per-sector meta captured during the
  // clearing-input build, joined to clearing results after the pass.
  const loyaltySectorMeta = new Map<
    string,
    { corpId: string; revenueAnchor: number; commodities: string[] }
  >();
  const sectorCorpId = new Map<string, string>();
  let brandLoyaltyUpdates: import("./brandLoyaltyTurn").CorpLoyaltyUpdate[] = [];
  if (market.clearingEnabled) {
    // Clearing pre-pass (Fix 2): needs every selling sector at once, so it
    // runs before the per-corp loop. Lagged balances/prices from lookups.
    //
    // FX (clearing collapse remediation, t879 clone A/B): sector.revenue is
    // stored in the corp's LOCAL currency, but the lagged balances the book
    // clears against are ₳-denominated (commodityPriceTurn anchor-normalizes
    // before unit accumulation). Offered units MUST be anchor-normalized the
    // same way, or high-rate currencies (JPY ~101, NGN ~1900 per ₳) inflate
    // the book ~7× in aggregate and every seller's fill collapses (~0.13
    // corporate mean fill in a market whose flows cleared 88%).
    const fxByCorpId = new Map<string, { code: CurrencyCode | undefined; rate: number }>();
    for (const corp of lookups.corporations) {
      fxByCorpId.set(corp._id.toString(), {
        code: resolveCorpLiquidCurrencyCode(corp),
        rate: fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency),
      });
    }
    const clearingInputs: SectorClearingInput[] = [];
    // Market partition (era worlds): each sector clears in its HOME COUNTRY's
    // reachable book (lookups.countryClearingBooks), not the worldwide one.
    const clearingGroupBySector = lookups.countryClearingBooks
      ? new Map<string, string>()
      : undefined;
    for (const [corpId, sectors] of lookups.sectorsByCorp) {
      const fx = fxByCorpId.get(corpId);
      for (const sector of sectors) {
        const baseRates = getEffectiveStrategyRates(
          sector.sectorType,
          sector.strategyId ?? "standard",
          sector.transitionFromStrategyId,
          sector.transitionStartTurn,
          turn ?? 0
        );
        // Same remap the world ledger applies (computeRawSupplyDemand): bloc
        // media offers state broadcasting, not advertising. If the offer and
        // the ledger disagree on the commodity, clearing's lagged-supply
        // reconciliation misfires.
        const rates = {
          ...baseRates,
          supply: applyPlannedEconomyOutputMix(
            sector.sectorType,
            baseRates.supply,
            isPlannedEconomy(
              (sector as { countryId?: string }).countryId,
              currentYear,
              commandEconomyEnabled
            )
          ),
        };
        const sectorId = sector._id.toString();
        // countryId is backfilled onto every sector in buildLookups (from
        // stateCountryMap, "US" fallback), so the cast is total in practice.
        if (clearingGroupBySector) {
          clearingGroupBySector.set(sectorId, (sector as { countryId?: string }).countryId ?? "US");
        }
        const revenueAnchor = readCorpEconomicAnchor(sector.revenue, fx?.code, fx?.rate ?? 1);
        if (supplyAgreementsEnabled) sectorCorpId.set(sectorId, corpId);
        // PRODUCTION SINK for the supply-agreement shortfall leg, filled HERE
        // rather than from clearing's offered `s.units`.
        //
        // The two are not the same number and must not be conflated.
        // `computeSupplyAgreementSettlements` throws if a sink arrives without
        // plants, because outside plants the offer is the post-normalization
        // revenue nameplate and damages assessed off a bookkeeping figure are
        // exactly what that guard exists to stop. Sourcing the sink from the
        // clearing offer defeated the guard from the other side: EXTRACTION is
        // deliberately excluded from the `producedUnits` offer below (it stays
        // on the nameplate so the lagged-supply normalization can reconcile it),
        // so extraction suppliers, the dominant commodity suppliers in the
        // world, had their contract damages assessed off precisely that
        // nameplate while the sink looked plants-clean.
        //
        // Reading `sector.producedUnits` directly keeps the sink measured
        // production for EVERY sector type, so the guard means what it says and
        // no sector type is quietly exempt from contract discipline. The same
        // `plantsSupplyScaledUnits` legs the offer and the world supply ledger
        // apply are applied here, and the propose-time capacity validator now
        // sizes `volumeCap` against the same scaled quantity.
        //
        // A mothballed sector contributes nothing and gets no entry, which the
        // settlement reads as zero produced (its documented meaning), a cold
        // plant owes damages on its whole contracted volume.
        if (supplyAgreementsEnabled && market.plantsEnabled && sector.mothballed !== true) {
          const scaled = plantsSupplyScaledUnits({
            producedUnits: sector.producedUnits,
            isNatcorp: !!lookups.corpById.get(corpId)?.countryOwnerId,
            // Mirrors the ledger (computeRawSupplyDemand): embargo haircut plus
            // the planned-economy media derate. Offer and ledger must agree.
            embargoSupplyFactor:
              embargoSupplyFactorFor(sector) *
              plannedEconomyMediaSupplyFactor(
                sector.sectorType,
                isPlannedEconomy(
                  (sector as { countryId?: string }).countryId,
                  currentYear,
                  commandEconomyEnabled
                )
              ),
          });
          if (scaled !== null && scaled > 0) {
            const supplyRates = rates.supply ?? {};
            for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
              const units =
                scaled *
                commodityMixWeight(
                  supplyRates,
                  eraScaledBasePrices(lookups.eraUnitScale),
                  commodity
                );
              if (!(units > 0)) continue;
              const byCommodity =
                producedByCorpCommodity.get(corpId) ?? new Map<CommodityType, number>();
              byCommodity.set(commodity, (byCommodity.get(commodity) ?? 0) + units);
              producedByCorpCommodity.set(corpId, byCommodity);
            }
          }
        }
        clearingInputs.push({
          sectorId,
          revenue: revenueAnchor,
          supplyRates: rates.supply ?? {},
          posture: typeof sector.pricingPosture === "number" ? sector.pricingPosture : null,
          // Lagged own fill for autoPosture's feedback loop (NPP/unowned only,
          // ignored when a player posture is posted).
          lastSoldFraction: typeof sector.soldFraction === "number" ? sector.soldFraction : null,
          // Owning corp's lagged loyalty for the slice pre-pass (A2b).
          brandLoyalty: brandLoyaltySliceEnabled
            ? (lookups.corpById.get(corpId)?.brandLoyalty ?? 0)
            : undefined,
          // Lagged owning-corp output quality for the premium coupling (Package B).
          // Prior-turn averageQuality, consistent with clearing's lagged inputs.
          outputQuality: qualityPremiumPricingEnabled
            ? (lookups.corpById.get(corpId)?.averageQuality ?? null)
            : undefined,
          // Plants tier: last turn's measured output is the offer (lagged, like
          // every other clearing input). Null for a sector that has never run a
          // plants turn, the book falls back to the revenue nameplate.
          //
          // `producedUnits` carries the REVENUE-side production legs, so the
          // legs the supply ledger applies on top of the same units and
          // sectorTurn's productionFactor does not (natcorpScale ×
          // outputMultiplier × embargoSupplyFactor) are applied here, through
          // the SAME shared helper the ledger uses. Without them the offer is
          // not ledger-consistent, and clearing exempts these units from the
          // lagged-supply normalization precisely on the claim that it is: a
          // high-output-policy sector would under-offer by up to 15%, and an
          // embargoed one over-offered against a ledger that had already
          // written those units off, with nothing left to reconcile it.
          //
          // EXTRACTION IS EXCLUDED, matching computeRawSupplyDemand's
          // deliberate `st !== "extraction"` exclusion. Under plants the
          // sector's revenue is restated to the capacity nameplate
          // (sectorTurn), so world supply for extraction still comes from the
          // legacy revenue derivation with the geological rationing applied
          // exactly once. `producedUnits` for extraction is a DIFFERENT number
          // (rationed by the plants hard-min lambda × throughput × policy), so
          // offering it would flag the seller `realUnits` and switch OFF the
          // normalization that is the only thing reconciling those two figures.
          // Leaving it undefined keeps extraction on the nameplate offer and
          // inside the normalization pass.
          //
          // MOTHBALLED is checked EXPLICITLY, matching the ledger's
          // `plantsMothballed` guard in constants/commodities. It is not
          // redundant: without it this site depends on `producedUnits` having
          // been persisted as 0 by a prior sectorTurn, a value written
          // elsewhere. If that ever stops holding, a cold plant would offer
          // units the ledger has already excluded, and `realUnits` offers are
          // exempt from the normalization that would otherwise catch it.
          producedUnits:
            market.plantsEnabled && sector.sectorType !== "extraction" && sector.mothballed !== true
              ? plantsSupplyScaledUnits({
                  producedUnits: sector.producedUnits,
                  isNatcorp: !!lookups.corpById.get(corpId)?.countryOwnerId,
                  embargoSupplyFactor:
                    embargoSupplyFactorFor(sector) *
                    plannedEconomyMediaSupplyFactor(
                      sector.sectorType,
                      isPlannedEconomy(
                        (sector as { countryId?: string }).countryId,
                        currentYear,
                        commandEconomyEnabled
                      )
                    ),
                })
              : undefined,
        });
        // Brand loyalty (A2): remember what the rollup needs, joined post-clearing.
        if (brandLoyaltyEnabled) {
          loyaltySectorMeta.set(sectorId, {
            corpId,
            revenueAnchor,
            commodities: Object.keys(rates.supply ?? {}).filter(
              (c) => (rates.supply?.[c as keyof typeof rates.supply] ?? 0) > 0
            ),
          });
        }
      }
    }
    // Book-sanity invariant: the diagnostic reports the RAW revenue/base nameplate.
    // A modest excess over lagged supply is EXPECTED and benign, the supply ledger
    // applies scale/haircut factors the nameplate omits, and clearing now reconciles
    // the book down to supply (so fills are not depressed). Only a unit-SCALE
    // divergence (≥3×) signals a genuine bug like the t879 FX book (~100×). Warn
    // loudly at that threshold; the benign haircut gap stays silent.
    const BOOK_MISMATCH_TRIPWIRE = 3;
    const bookViolations: string[] = [];
    market.clearingBySectorId = computeClearingFactors({
      sectors: clearingInputs,
      balances: lookups.globalCommodityBalances,
      // Era worlds: one book per seller home country, scoped to the demand the
      // trade graph lets that country reach (embargoes/tariffs/autarky). Null
      // on modern worlds → the single worldwide book, unchanged.
      groupBySector: clearingGroupBySector,
      balancesByGroup: lookups.countryClearingBooks ?? undefined,
      priceRatioByCommodity: lookups.priceRatioByCommodity,
      // Partitioned worlds: each seller's price-realization leg reads its home
      // country's lagged reachable price. Sparse map; falls back to the
      // worldwide ratio per commodity. Modern worlds: no groups, unused.
      priceRatioByGroup: clearingGroupBySector ? lookups.reachablePriceRatioByCountry : undefined,
      // The era table: clearing compares sector offers (era-based units under
      // plants) against the ledger's balances, which run on the same basis.
      basePrices: eraScaledBasePrices(lookups.eraUnitScale),
      loyaltySliceEnabled: brandLoyaltySliceEnabled,
      contractedByCorpCommodity: supplyAgreementsEnabled ? contractedByCorpCommodity : undefined,
      sectorCorpId: supplyAgreementsEnabled ? sectorCorpId : undefined,
      exclusiveByCorpCommodity: supplyAgreementsEnabled ? exclusiveByCorpCommodity : undefined,
      contractSettlementOut: supplyAgreementsEnabled ? contractSettlementByCorp : undefined,
      // The shortfall sink is no longer fed from the clearing offer, see the
      // PRODUCTION SINK note in the input loop above. Clearing's `s.units` is
      // an offer, and for extraction it is the revenue nameplate, so it cannot
      // stand in for measured production.
      producedUnitsOut: undefined,
      qualityPremiumEnabled: qualityPremiumPricingEnabled,
      plantsEnabled: market.plantsEnabled,
      onBookDiagnostic: (d) => {
        if (d.laggedSupply > 0 && d.offeredUnits > d.laggedSupply * BOOK_MISMATCH_TRIPWIRE) {
          bookViolations.push(
            `${d.commodity}: offered ${Math.round(d.offeredUnits)} vs lagged supply ${Math.round(d.laggedSupply)} (${(d.offeredUnits / d.laggedSupply).toFixed(1)}×)`
          );
        }
      },
    });
    if (bookViolations.length > 0) {
      console.warn(
        `[clearing] order-book/ledger unit mismatch on ${bookViolations.length} commodit${bookViolations.length === 1 ? "y" : "ies"}, fills will be depressed: ${bookViolations.slice(0, 5).join("; ")}`
      );
    }

    // Brand loyalty (A2): roll up per-corp posture/fill/contest from the clearing
    // results and advance each corp's loyalty. Shadow-safe, the resulting
    // brandLoyalty/brandPostureNorm are persisted, but nothing READS them until
    // the slice pre-pass (A2b, brandLoyaltySliceEnabled) is turned on.
    if (brandLoyaltyEnabled) {
      const byCorp = new Map<string, import("./brandLoyaltyTurn").CorpLoyaltyInput>();
      for (const [sectorId, meta] of loyaltySectorMeta) {
        const clearing = market.clearingBySectorId?.get(sectorId);
        if (!clearing) continue;
        let entry = byCorp.get(meta.corpId);
        if (!entry) {
          const corp = lookups.corpById.get(meta.corpId);
          entry = {
            corpId: meta.corpId,
            priorLoyalty: corp?.brandLoyalty,
            priorNorm: corp?.brandPostureNorm,
            sectors: [],
          };
          byCorp.set(meta.corpId, entry);
        }
        (entry.sectors as LoyaltySectorInput[]).push({
          revenueAnchor: meta.revenueAnchor,
          effectivePosture: clearing.effectivePosture,
          soldFraction: clearing.soldFraction,
          commodities: meta.commodities,
        });
      }
      brandLoyaltyUpdates = computeBrandLoyaltyUpdates([...byCorp.values()]);
      // Keep the in-memory corp docs consistent with the just-computed values so
      // the corporationHistory snapshot (built later from corpById) charts the
      // CURRENT turn's loyalty, not last turn's.
      for (const lu of brandLoyaltyUpdates) {
        const corp = lookups.corpById.get(lu.corpId);
        if (corp) {
          corp.brandLoyalty = Math.round(lu.loyalty * 100) / 100;
          corp.brandPostureNorm = Math.round(lu.postureNorm * 10000) / 10000;
        }
      }
    }
  }
  mark("marketContext");

  // Output quality (four pillars): compute per-sector quality → corp
  // averageQuality + per-commodity quality (propagates to next turn's inputs).
  // Independent of clearing; flag-gated. Display/telemetry only in this phase.
  let qualityCorpUpdates = new Map<string, number>();
  let newCommodityQuality: Map<CommodityType, number> | null = null;
  if (sectorQualityEnabled) {
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
        const rates = getEffectiveStrategyRates(
          sector.sectorType,
          sector.strategyId ?? "standard",
          sector.transitionFromStrategyId,
          sector.transitionStartTurn,
          turn ?? 0
        );
        const outputs = (Object.keys(rates.supply ?? {}) as CommodityType[]).filter(
          (c) => (rates.supply?.[c] ?? 0) > 0
        );
        const inputs = (Object.keys(rates.demand ?? {}) as CommodityType[]).filter(
          (c) => (rates.demand?.[c] ?? 0) > 0
        );
        return {
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
    const { corpQuality, commodityQuality } = computeQualityUpdates(qCorps, laggedQ);
    qualityCorpUpdates = corpQuality;
    newCommodityQuality = commodityQuality;
    // Keep in-memory corp docs current so the history snapshot charts this turn.
    for (const [corpId, q] of corpQuality) {
      const corp = lookups.corpById.get(corpId);
      if (corp) corp.averageQuality = q;
    }
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

  // Forensics/alt-detection audit spine (plan §3.1, T2.7): aggregate,
  // NOT-per-corp entries for this turn's silent auto-mutations (vacant/
  // inactive-CEO sector shedding, NPP caretaker installs, subsidiary
  // cleanup). Collected once and flushed via a single `recordAuditBulk` call
  // near the end of this function, corporationTurn is the known turn-loop
  // hotspot, so no per-corp writes here, just cheap counts already computed
  // by each sub-step.
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
    corpSnapshots,
    ceoSalaryPayments,
    dividendPayments,
    corpDividendPaymentsAnchorByCorpId,
    corpDividendPaymentsAnchorByCorpCurrency,
    sectorFxSpreadFees,
    fundDividendAccruals,
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
    strikeEvents,
    capacityBindingEvents,
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
    privateBankingEnabled
  );
  mark("processSectors(CPU)");

  // Phase 2b: NPP corporation AI decisions, budgets, expansion, dividends
  // Run before bulk writes so NPP decisions are applied this turn.
  const {
    corpUpdates: nppCorpUpdates,
    sectorUpdates: nppSectorUpdates,
    newSectors: nppNewSectors,
    divestedSectorIds: nppDivestedSectorIds,
  } = await processNppCorporationDecisions(db, turn ?? 0, now, techTreesEnabled);
  mark("nppCorpDecisions");

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
    await db.collection("corporateSectors").deleteMany({ _id: { $in: nppDivestedSectorIds } });
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

  // Phase 3: Bulk write sector and corp updates
  if (sectorOps.length > 0) {
    // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing, runtime shape is valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("corporateSectors").bulkWrite(sectorOps as any[]);
  }
  if (corpOps.length > 0) {
    // bulkWrite op array type doesn't satisfy AnyBulkWriteOperation narrowing, runtime shape is valid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.collection("corporations").bulkWrite(corpOps as any[]);
  }
  mark("sector+corp bulkWrites");

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
  for (const { fromCurrency, toCurrency, fee } of sectorFxSpreadFees) {
    await distributeConversionSpread(db, fee, fromCurrency, toCurrency);
  }

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
  // PLANTS-GATED: this is the WRITE half of the NPP founding insert whose
  // document half lives in `nppCorporationBehavior.buildNppSectorDocs`, the
  // docs carry a `revenue` key, so this statement is a `corporateSectors.revenue`
  // writer and is registered as one. It stayed invisible to the writer-registry
  // guard for a while because the guard could only read an insert whose argument
  // was a literal `[` / `{`; this one passes a variable, so there was no document
  // text to scan. The guard now recognizes an indirect insert on the collection
  // by name and demands registration for it, see `sectorRevenueWriters.guard.test.ts`.
  //
  // Under plants the `revenue` on each doc is the legacy NAMEPLATE only: the new
  // sector is born with `capitalStock: 0`, its founding order sitting in
  // `buildQueue`, `constructionInProgressAnchor` equal to the order's paid ₳ and
  // `plantsStartTurn` stamped, and `sectorTurn` restates `revenue` from capacity
  // on the very next tick. Below plants the nameplate is the operative figure.
  // Either way the quantity that matters is written by the builder, not here.
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

  // Phase 3a: SOE operations, apply public-service mandate metric contributions
  // and back operating losses from the treasury (spec §11.1/§11.2). Runs after
  // sector/corp writes so liquidCapital reflects this turn's result, and within
  // the corp turn so the metric writes precede the late state-metrics phase.
  mark("acumen+fxSpread+newSectors");
  await processSoeOperations(db, now, currentYear);

  // Phase 3a': NatCorp profit remittance, split this turn's SOE operating profit
  // between CEO retention (stays in liquidCapital) and remittance to the treasury
  // reserve (spec P6g §5.1). Runs after loss-backing so it only acts on a positive
  // balance, and reuses the same estimate the budget revenue line scales by.
  mark("soeOperations");
  await processSoeRemittance(db, now);
  mark("soeRemittance");

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
  if (fundDividendAccruals.length > 0) {
    const { isIndexFundsEnabled } = await import("@/lib/indexFunds/featureFlag");
    if (await isIndexFundsEnabled()) {
      // I/O batching (measured: this step is ~42% of corporationTurn and is
      // dominated by ~5k serial DB round-trips/turn on prod remote Mongo).
      // AHD_BATCH_FUND_DIVIDENDS=on collapses them into a handful of bulk ops via
      // processIndexFundDividendsBatch, behaviourally identical (verified by an
      // equivalence test), off by default until a human-gated flip.
      if (process.env.AHD_BATCH_FUND_DIVIDENDS === "on") {
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

  mark("rd+fundDividends");
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
        producedByCorpCommodity: market.plantsEnabled ? producedByCorpCommodity : undefined,
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
      lookups.sectorsByCorp,
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
    // Resolve nationalizations whose notice window has elapsed (spec §14): cure-cancel
    // or complete the taking. Awaited so its effects land within this corp turn.
    await processPendingNationalizations(db, turn);
    // Resolve privatization auctions whose bid window has closed (spec §13.3):
    // sell to the top bidder or re-absorb the unsold carve-out.
    await processNationalizationAuctions(db, turn);

    // Financial-distress clock for the executive-nationalization grace window.
    // Runs last, after pending takings may have removed seized corps and all
    // liquidCapital writes have settled, so it reads each surviving player corp's
    // post-turn cash. Best-effort: a hiccup must not fail the turn.
    try {
      await trackFinancialDistress(db, turn);
    } catch (err) {
      logger.error("corporationTurn", "financial-distress tracking failed", err);
    }

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
  mark("votes+nationalizations+distress");

  // One bulk write for the whole turn's aggregate corp-audit entries, never
  // per-corp (perf guard, see comment above `corpAuditEntries`).
  if (corpAuditEntries.length > 0) {
    recordAuditBulk(corpAuditEntries);
  }

  if (timingOn) {
    const total = timings.reduce((s, [, ms]) => s + ms, 0);
    console.log(`[corp-timing] turn=${turn ?? "?"} total=${total}ms ${JSON.stringify(timings)}`);
  }

  return {
    corporationsProcessed: lookups.corporations.length,
    sectorsProcessed,
    totalRevenueGenerated: Math.round(totalRevenueGenerated),
    totalIncomeGenerated: Math.round(totalIncomeGenerated),
    currencyIncomeInternalByCharacterId,
    currencyIncomeFaceByCharacterId,
  };
}
