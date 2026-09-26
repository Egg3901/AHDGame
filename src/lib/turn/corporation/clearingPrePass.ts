import {
  computeClearingFactors,
  describeClearingBookBreach,
  type SectorClearingInput,
} from "@/lib/market/clearing";
import type { MarketContext } from "@/lib/market/marketContext";
import type { buildCorporationLookups } from "./buildLookups";
import {
  computeBrandLoyaltyUpdates,
  type CorpLoyaltyInput,
  type CorpLoyaltyUpdate,
  type LoyaltySectorInput,
} from "./brandLoyaltyTurn";
import {
  getEffectiveStrategyRates,
  applyPlannedEconomyOutputMix,
  plannedEconomyMediaSupplyFactor,
} from "@/lib/constants/sectorStrategies";
import { isPlannedEconomy } from "@/lib/constants/commandEconomy";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import {
  eraScaledBasePrices,
  commodityMixWeight,
  embargoSupplyFactorFor,
  plantsSupplyScaledUnits,
  scaleMeasuredProducedUnits,
  type CommodityType,
} from "@/lib/constants/commodities";
import { freshMilitaryDiversion } from "@/lib/military/arsenal";
import {
  computeDemandCappedContractReservations,
  computeSupplyAgreementBuyerDemand,
  type SettleableSupplyAgreement,
  type SupplyAgreementDemandSector,
} from "./settleSupplyAgreements";
import { computeContractProductionTargets } from "./contractProductionDemand";
import { FREIGHT_CLASS_BY_COMMODITY, type FreightClass } from "@/lib/logistics/freightClass";
import { contractScopeKeysFor } from "./loadSettleableSupplyAgreements";
import {
  fxRateForSectorHostFromMap,
  resolveSectorHostCurrencyCode,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { advertisingDeliveredValueByCorp } from "./advertisingDeliveredValue";

/**
 * Clearing pre-pass for the corporation turn, extracted from index.ts so the
 * entry point stays under the architecture audit file-size cap.
 *
 * Builds every selling sector's clearing offer (revenue anchor plus the
 * plants-tier measured-production legs on the canonical ledger basis), runs
 * the market clearing-factors pass with the book invariant diagnostic,
 * values delivered advertising, and rolls up brand-loyalty updates.
 * Synchronous and DB-free: all reads happened in the lookup build, all
 * writes happen downstream. Mutates `market` and the corp/commodity maps in
 * place, and returns the breach texts, loyalty updates, and contract maps.
 */
export interface ClearingPrePassInput {
  lookups: Awaited<ReturnType<typeof buildCorporationLookups>>;
  market: MarketContext;
  turn: number | undefined;
  currentYear: number | undefined;
  commandEconomyEnabled: boolean;
  freightSettlementActive: boolean;
  supplyAgreementsEnabled: boolean;
  settleableAgreements: SettleableSupplyAgreement[] | undefined;
  contractedByCorpCommodity: Map<string, Map<string, number>> | undefined;
  contractSettlementByCorp: Map<string, Map<string, number>>;
  producedByCorpCommodity: Map<string, Map<string, number>>;
  achievableByCorpCommodity: Map<string, Map<string, number | null>>;
  stateLocalClearingBlockedByLegacyAgreement: boolean;
  brandLoyaltyEnabled: boolean;
  brandLoyaltySliceEnabled: boolean;
  qualityPremiumPricingEnabled: boolean;
}

export interface ClearingPrePassResult {
  clearingInvariantBreaches: string[];
  brandLoyaltyUpdates: CorpLoyaltyUpdate[];
  contractedByCorpCommodity: Map<string, Map<string, number>> | undefined;
  buyerDemandByCorpCommodity: Map<string, Map<string, number>> | undefined;
}

export function runClearingPrePass(input: ClearingPrePassInput): ClearingPrePassResult {
  const {
    lookups,
    market,
    turn,
    currentYear,
    commandEconomyEnabled,
    freightSettlementActive,
    supplyAgreementsEnabled,
    settleableAgreements,
    contractSettlementByCorp,
    producedByCorpCommodity,
    achievableByCorpCommodity,
    stateLocalClearingBlockedByLegacyAgreement,
    brandLoyaltyEnabled,
    brandLoyaltySliceEnabled,
    qualityPremiumPricingEnabled,
  } = input;
  let { contractedByCorpCommodity } = input;
  let buyerDemandByCorpCommodity: Map<string, Map<string, number>> | undefined;
  // Brand loyalty (A2, shadow-safe): per-sector meta captured during the
  // clearing-input build, joined to clearing results after the pass.
  const loyaltySectorMeta = new Map<
    string,
    { corpId: string; revenueAnchor: number; commodities: string[] }
  >();
  const sectorCorpId = new Map<string, string>();
  // Clearing book invariant breaches (issue #2054) for this turn's warning
  // channel. Deterministic text per book, so a retried or replayed turn
  // records each breach exactly once downstream.
  const clearingInvariantBreaches: string[] = [];
  let brandLoyaltyUpdates: CorpLoyaltyUpdate[] = [];
  if (market.clearingEnabled) {
    // Clearing pre-pass (Fix 2): needs every selling sector at once, so it
    // runs before the per-corp loop. Lagged balances/prices from lookups.
    //
    // FX (clearing collapse remediation, t879 clone A/B): sector.revenue is
    // stored in the HOST market's local currency, but the lagged balances the book
    // clears against are ₳-denominated (commodityPriceTurn anchor-normalizes
    // before unit accumulation). Offered units MUST be anchor-normalized the
    // same way, or high-rate currencies (JPY ~101, NGN ~1900 per ₳) inflate
    // the book ~7× in aggregate and every seller's fill collapses (~0.13
    // corporate mean fill in a market whose flows cleared 88%).
    const clearingInputs: SectorClearingInput[] = [];
    const supplyAgreementDemandSectors: SupplyAgreementDemandSector[] = [];
    // Market partition (era worlds): each sector clears in its HOME COUNTRY's
    // reachable book (lookups.countryClearingBooks), not the worldwide one.
    const clearingGroupBySector = lookups.countryClearingBooks
      ? new Map<string, string>()
      : undefined;
    // State-scoped clearing: freight is a state's own haulage
    // capacity, so it clears against that state's book rather than a national
    // one. Built for every world, not just era worlds, because the constraint
    // is physical rather than a trade-graph artifact.
    const clearingStateBySector = new Map<string, string>();
    // Freight seam: per sector, the share of its offer that no network could
    // place. Populated only while settlement is active, so worlds with it off
    // (and every modern world) offer exactly what they offered before.
    const deliveryLimitedBySectorId = new Map<string, number>();
    const deliveryLimitedClassBySectorId = new Map<string, FreightClass | null>();
    /**
     * Share of a sector's output its host state could place last turn, 1 when
     * there is no measured limit. Min across the sector's output commodities:
     * one output leg that cannot leave the state caps the whole offer, because
     * a sector's units split across its mix rather than choosing a leg.
     */
    const placementRatioForSector = (
      stateId: string | undefined,
      supplyRates: Partial<Record<CommodityType, number>>
    ): number => {
      if (!freightSettlementActive || !stateId) return 1;
      const byCommodity = lookups.statePlacementRatioByState?.get(stateId);
      if (!byCommodity) return 1;
      let ratio = 1;
      for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
        if (!((supplyRates[commodity] ?? 0) > 0)) continue;
        ratio = Math.min(ratio, byCommodity.get(commodity) ?? 1);
      }
      return Math.max(0, Math.min(1, ratio));
    };
    /**
     * Share of a sector's output that was wanted and still could not be
     * delivered, 0 when there is no measured limit. MAX across output legs,
     * the mirror of the MIN above: the leg that binds the offer is the leg
     * with the worst placement, so its delivery share is the sector's. It can
     * never exceed the haircut the offer took, because each leg's
     * delivery-limited share is a part of that same leg's unplaced share.
     *
     * Separate from `1 - placementRatio` on purpose. That number also contains
     * plain glut, and the sector surface tells the player to build freight on
     * the strength of this one.
     */
    const deliveryLimitedForSector = (
      stateId: string | undefined,
      supplyRates: Partial<Record<CommodityType, number>>
    ): { fraction: number; freightClass: FreightClass | null } => {
      if (!freightSettlementActive || !stateId) return { fraction: 0, freightClass: null };
      const byCommodity = lookups.stateDeliveryLimitedRatioByState?.get(stateId);
      if (!byCommodity) return { fraction: 0, freightClass: null };
      let ratio = 0;
      let freightClass: FreightClass | null = null;
      for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
        if (!((supplyRates[commodity] ?? 0) > 0)) continue;
        const candidate = byCommodity.get(commodity) ?? 0;
        if (candidate > ratio) {
          ratio = candidate;
          freightClass = FREIGHT_CLASS_BY_COMMODITY[commodity];
        }
      }
      return { fraction: Math.max(0, Math.min(1, ratio)), freightClass };
    };
    for (const [corpId, sectors] of lookups.sectorsByCorp) {
      const corp = lookups.corpById.get(corpId);
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
        // A sector cannot offer a resource its state has no reserves of. Every
        // other consumer of the supply mix already filters on state capacity
        // (sectorTurn, the world supply ledger, the sector page), but the
        // clearing OFFER did not, so an extraction sector in a resource-poor
        // state put all six extraction legs on the book. The missing legs land
        // in a book with no supply and no demand, clear at zero, and are still
        // rate-weighted into `soldFraction`, which is what the sector page
        // thresholds "this market is oversupplied" on. Every DD extraction
        // sector sat at 0.435-0.498 against a 0.5 threshold and so read as
        // permanently oversupplied on output it could never have made.
        //
        // Order matters: the planned-economy remap runs first (it can swap the
        // commodity entirely), then the capacity filter culls what the state
        // cannot extract. The helper no-ops for non-extraction sectors and for
        // states with no capacity document, so nothing else moves.
        const rates = {
          ...baseRates,
          supply: applyExtractionResourceCapacityToSupply(
            sector.sectorType,
            applyPlannedEconomyOutputMix(
              sector.sectorType,
              baseRates.supply,
              isPlannedEconomy(
                (sector as { countryId?: string }).countryId,
                currentYear,
                commandEconomyEnabled
              )
            ),
            lookups.stateResourceCapacityByState.get(sector.stateId)
          ),
        };
        const sectorId = sector._id.toString();
        // countryId is backfilled onto every sector in buildLookups (from
        // stateCountryMap, "US" fallback), so the cast is total in practice.
        if (clearingGroupBySector) {
          clearingGroupBySector.set(sectorId, (sector as { countryId?: string }).countryId ?? "US");
        }
        const hostCode = resolveSectorHostCurrencyCode(sector, corp);
        const hostRate = fxRateForSectorHostFromMap(sector, corp, lookups.exchangeRatesByCurrency);
        const revenueAnchor = readCorpEconomicAnchor(sector.revenue, hostCode, hostRate);
        // Shared ownership map for both bilateral supply agreements and the
        // anonymous advertising settlement that follows clearing.
        sectorCorpId.set(sectorId, corpId);
        if (supplyAgreementsEnabled) {
          supplyAgreementDemandSectors.push({
            corporationId: corpId,
            sectorType: sector.sectorType,
            revenueAnchor,
            strategyId: sector.strategyId,
            transitionFromStrategyId: sector.transitionFromStrategyId,
            transitionStartTurn: sector.transitionStartTurn,
            productionPolicyLevel: sector.productionPolicyLevel,
            producedUnits: sector.producedUnits,
            capacityUnits: sector.operatingCapacityUnits ?? sector.capitalStock,
            mothballed: sector.mothballed,
            isNatcorp: !!lookups.corpById.get(corpId)?.countryOwnerId,
            ...(sector.stateId ? { stateId: sector.stateId } : {}),
          });
        }
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
        // The achievable ceiling is accumulated for EVERY sector including
        // mothballed ones. A cold plant produces nothing and gets no entry in
        // the produced map (its documented "zero produced" meaning), but its
        // ceiling is still its full capacity because mothballing is the operator's
        // own choice and must keep owing damages on the whole contracted
        // volume. Skipping it here would hand back the exact exploit the
        // damages leg exists to close.
        if (supplyAgreementsEnabled && market.plantsEnabled) {
          const achievableScaled = plantsSupplyScaledUnits({
            producedUnits: sector.contractAchievableUnits,
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
          });
          const supplyRates = rates.supply ?? {};
          for (const commodity of Object.keys(supplyRates) as CommodityType[]) {
            const weight = commodityMixWeight(
              supplyRates,
              eraScaledBasePrices(lookups.eraUnitScale),
              commodity
            );
            if (!(weight > 0)) continue;
            const byKey = achievableByCorpCommodity.get(corpId) ?? new Map<string, number | null>();
            for (const key of contractScopeKeysFor(commodity, sector.stateId)) {
              const accumulated = byKey.get(key);
              if (achievableScaled === null || accumulated === null) {
                // One unknown contributing sector makes the group total unknown.
                // A measured zero remains numeric zero and must not fall through
                // to the settlement's intentionally-unclamped rollout behavior.
                byKey.set(key, null);
              } else {
                byKey.set(key, (accumulated ?? 0) + achievableScaled * weight);
              }
            }
            achievableByCorpCommodity.set(corpId, byKey);
          }
        }
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
              const byKey = producedByCorpCommodity.get(corpId) ?? new Map<string, number>();
              for (const key of contractScopeKeysFor(commodity, sector.stateId)) {
                byKey.set(key, (byKey.get(key) ?? 0) + units);
              }
              producedByCorpCommodity.set(corpId, byKey);
            }
          }
        }
        const clearingInput: SectorClearingInput = {
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
          // outputMultiplier × embargoSupplyFactor, plus the arsenal-retention
          // share for output shipped to a state arsenal under a defence
          // contract) are applied here, through the SAME shared helper the
          // ledger uses. Without them the offer is not ledger-consistent, and
          // clearing exempts these units from the lagged-supply normalization
          // precisely on the claim that it is: a high-output-policy sector
          // would under-offer by up to 15%, an embargoed one over-offered
          // against a ledger that had already written those units off, and a
          // contracted one over-offered output the arsenal had already taken,
          // with nothing left to reconcile any of it.
          //
          // The arsenal leg reads `freshMilitaryDiversion` exactly like the
          // ledger's sector rows do (same staleness window, same turn), so a
          // diversion cannot be fresh on one side and expired on the other.
          // `producedUnits` itself is gross physical output in both places;
          // the matching cash-side deduction lives in sectorTurn's revenue
          // leg, so nothing here double-applies.
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
              ? scaleMeasuredProducedUnits({
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
                  // Arsenal-retention leg (issue #2054): the world supply
                  // ledger multiplies this same share out of supply, so an
                  // offer built without it sits in a larger basis and trips
                  // the clearing invariant while depressing fills. Absent (no
                  // fresh diversion) retains everything: non-contracted
                  // sectors are byte-identical to before.
                  militaryRetainedFraction: 1 - freshMilitaryDiversion(sector, turn ?? 0),
                })
              : undefined,
        };
        // FREIGHT SEAM (t225). The offer now carries delivery feasibility.
        //
        // A sector's `soldFraction` came out of a COUNTRY-scoped book while its
        // rationing came out of STATE-scoped freight settlement, and neither
        // knew about the other: 60.4% of world production was being made in a
        // state that did not need it while 28.7% of world demand went unmet,
        // and a Texas extraction sector could not sell its natural gas with a
        // Texas energy plant next door starved of it. Clearing GRANULARITY is
        // deliberately unchanged (a country is still the market); the offer is
        // simply capped at what a network could move out of the seller's state.
        //
        // MIN over the sector's outputs, not a mean: output splits across the
        // mix by `commodityMixWeight`, so a chemical plant cannot place its
        // chemicals through a plastics network (the same reasoning as
        // sectorDemandGapUnits). Both offer bases are scaled, since either can
        // be the one clearing reads. The cap is TOTAL placement, glut included:
        // the book should carry only what could actually be placed, whatever
        // stopped it.
        //
        // SCOPE: this makes the OFFER honest, not the revenue leg. sectorTurn
        // multiplies by `soldFraction` rather than absolute sold units, and
        // clearing's `demandForPass` shrinks with the offer, so a stranded
        // seller still books close to its old revenue. Whether a badly sited
        // corp should lose money for it is an owner decision on a live world,
        // deliberately left open; do not assume the loop is closed.
        const placementRatio = placementRatioForSector(sector.stateId, rates.supply ?? {});
        if (placementRatio < 1) {
          clearingInput.revenue *= placementRatio;
          if (typeof clearingInput.producedUnits === "number") {
            clearingInput.producedUnits *= placementRatio;
          }
        }
        if (freightSettlementActive) {
          const deliveryLimit = deliveryLimitedForSector(sector.stateId, rates.supply ?? {});
          deliveryLimitedBySectorId.set(sectorId, deliveryLimit.fraction);
          deliveryLimitedClassBySectorId.set(sectorId, deliveryLimit.freightClass);
        }
        if (sector.stateId) clearingStateBySector.set(sectorId, sector.stateId);
        clearingInputs.push(clearingInput);
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
    if (supplyAgreementsEnabled && settleableAgreements) {
      buyerDemandByCorpCommodity = computeSupplyAgreementBuyerDemand({
        sectors: supplyAgreementDemandSectors,
        currentTurn: turn ?? 0,
        unitScale: market.plantsEnabled ? lookups.eraUnitScale : 1,
        plantsEnabled: market.plantsEnabled,
      });
      contractedByCorpCommodity = computeDemandCappedContractReservations({
        agreements: settleableAgreements,
        buyerDemandByCorpCommodity,
      });
      if (market.plantsEnabled && contractedByCorpCommodity.size > 0) {
        const supplyRatesBySectorId = new Map<string, Partial<Record<CommodityType, number>>>();
        for (const input of clearingInputs) {
          supplyRatesBySectorId.set(input.sectorId, input.supplyRates);
        }
        market.contractProductionTargetBySectorId = computeContractProductionTargets({
          reservations: contractedByCorpCommodity,
          sectors: [...lookups.sectorsByCorp.values()].flatMap((sectors) =>
            sectors.map((sector) => ({
              sectorId: sector._id.toString(),
              corporationId: sector.corporationId.toString(),
              stateId: sector.stateId,
              capacityUnits: sector.operatingCapacityUnits ?? sector.capitalStock,
              supplyRates: supplyRatesBySectorId.get(sector._id.toString()) ?? {},
              mothballed: sector.mothballed,
            }))
          ),
          basePrices: eraScaledBasePrices(lookups.eraUnitScale),
        });
      }
    }
    // Book-sanity invariant (issue #2054): the diagnostic reports the RAW
    // revenue/base nameplate. A modest excess over lagged supply is EXPECTED
    // and benign, the supply ledger applies scale/haircut factors the
    // nameplate omits, and clearing reconciles the book down to supply (so
    // fills are not depressed). Only a post-normalization breach of the
    // canonical-basis invariant signals a genuine defect: both sides now
    // build plants units through one basis, so a residual excess means the
    // book and the ledger drifted apart and fills ARE depressed. Breaches go
    // to the turn warning channel (and the health snapshot's warningCount),
    // not just the worker log.
    const bookViolations: string[] = clearingInvariantBreaches;
    // Telemetry only, and only while settlement is active: sectorTurn writes it
    // beside the fill it is NOT part of, so a player can read "nobody wanted it"
    // apart from "it could not get there". Carries the delivery-attributed
    // share alone, never the whole offer haircut.
    if (freightSettlementActive) {
      market.deliveryLimitedBySectorId = deliveryLimitedBySectorId;
      market.deliveryLimitedClassBySectorId = deliveryLimitedClassBySectorId;
    }
    market.clearingBySectorId = computeClearingFactors({
      sectors: clearingInputs,
      balances: lookups.globalCommodityBalances,
      initializedLaggedBooks: lookups.initializedLaggedBooks,
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
      // Freight capacity clears where it is based. The whole context is
      // withheld while a legacy freight agreement is live because old
      // corporation-wide contracts carry no state identity and cannot be
      // reinterpreted safely mid-contract.
      stateMarkets: stateLocalClearingBlockedByLegacyAgreement
        ? undefined
        : {
            stateBySector: clearingStateBySector,
            balances: lookups.rawStateBalances,
            priceRatios: lookups.statePriceRatioByState ?? new Map(),
          },
      // The era table: clearing compares sector offers (era-based units under
      // plants) against the ledger's balances, which run on the same basis.
      basePrices: eraScaledBasePrices(lookups.eraUnitScale),
      loyaltySliceEnabled: brandLoyaltySliceEnabled,
      contractedByCorpCommodity: supplyAgreementsEnabled ? contractedByCorpCommodity : undefined,
      sectorCorpId: supplyAgreementsEnabled ? sectorCorpId : undefined,
      contractSettlementOut: supplyAgreementsEnabled ? contractSettlementByCorp : undefined,
      // The shortfall sink is no longer fed from the clearing offer, see the
      // PRODUCTION SINK note in the input loop above. Clearing's `s.units` is
      // an offer, and for extraction it is the revenue nameplate, so it cannot
      // stand in for measured production.
      producedUnitsOut: undefined,
      qualityPremiumEnabled: qualityPremiumPricingEnabled,
      plantsEnabled: market.plantsEnabled,
      // One diagnostic per cleared book; the text is deterministic per book
      // (see describeClearingBookBreach), so a retried turn cannot record the
      // same breach twice downstream.
      onBookDiagnostic: (d) => {
        if (d.invariantBreach) {
          bookViolations.push("corporationTurn: " + describeClearingBookBreach(d));
        }
      },
    });

    // Marketing budgets are a real corporation cost, so filled advertising
    // must have a real recipient. Reproduce clearing's offer normalization for
    // this commodity, then value each seller's actually delivered units at its
    // reachable price. processSectors routes that delivered value through one
    // equal-and-opposite transfer.
    const clearingBasePrices = eraScaledBasePrices(lookups.eraUnitScale);
    const advertisingSellerDeliveredValueAnchorByCorpId = advertisingDeliveredValueByCorp({
      inputs: clearingInputs.map((input) => ({
        sectorId: input.sectorId,
        supplyRates: input.supplyRates,
        revenue: input.revenue,
        producedUnits: input.producedUnits,
        outputQuality: input.outputQuality,
      })),
      clearingBasePrices,
      plantsEnabled: market.plantsEnabled,
      clearingGroupBySector,
      clearingBySectorId: market.clearingBySectorId,
      countryClearingBooks: lookups.countryClearingBooks,
      globalCommodityBalances: lookups.globalCommodityBalances,
      reachablePriceRatioByCountry: lookups.reachablePriceRatioByCountry,
      priceRatioByCommodity: lookups.priceRatioByCommodity,
      sectorCorpId,
      commodityMixWeight,
      qualityPremiumPricingEnabled,
    });
    market.advertisingSellerDeliveredValueAnchorByCorpId =
      advertisingSellerDeliveredValueAnchorByCorpId;
    if (bookViolations.length > 0) {
      console.warn(
        "[clearing] canonical-basis invariant breach on " +
          bookViolations.length +
          " market book" +
          (bookViolations.length === 1 ? "" : "s") +
          ", fills may be depressed: " +
          bookViolations.slice(0, 5).join("; ")
      );
    }

    // Brand loyalty (A2): roll up per-corp posture/fill/contest from the clearing
    // results and advance each corp's loyalty. Shadow-safe, the resulting
    // brandLoyalty/brandPostureNorm are persisted, but nothing READS them until
    // the slice pre-pass (A2b, brandLoyaltySliceEnabled) is turned on.
    if (brandLoyaltyEnabled) {
      const byCorp = new Map<string, CorpLoyaltyInput>();
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
  return {
    clearingInvariantBreaches,
    brandLoyaltyUpdates,
    contractedByCorpCommodity,
    buyerDemandByCorpCommodity,
  };
}
