/**
 * Bilateral supply-agreement settlement (supplyAgreementsEnabled).
 *
 * The clearing pre-pass already sells each supplier's contracted units at MARKET
 * price into the anonymous demand pool (the money-conserving baseline — those
 * units clear and land in `liquidCapital` via the normal revenue→income path).
 * A supply agreement additionally locks the price at `market × (1 + premium)`.
 * We settle that lock as a **contract-for-difference**: a discrete cash transfer
 * of the premium delta between buyer and supplier, layered on top of the market
 * baseline. This conserves total corp cash exactly (equal-and-opposite ₳ legs)
 * and never touches the fragile revenue/margin/tax/share-price legs.
 *
 * Per settled agreement:
 *   qty        = the supplier's contracted units that actually cleared, split
 *                across its agreements for that commodity pro-rata by volumeCap
 *   unitPriceₐ = COMMODITY_BASE_PRICES[commodity] × laggedPriceRatio  (in ₳)
 *   premiumₐ   = qty × unitPriceₐ × pricePremium
 *   supplier `liquidCapital` += premiumₐ (→ its currency); buyer -= premiumₐ.
 *
 * A positive premium ⇒ the buyer pays the supplier above market (guaranteed
 * supply at a locked, higher price); a negative premium ⇒ the supplier subsidises
 * the buyer (a discount). The base commodity sale is already taxed as ordinary
 * corp revenue; this side-payment is not taxed again.
 *
 * SHORTFALL (plants tier). A contract is a promise about physical goods, so a
 * supplier that PRODUCED less than it contracted owes the buyer damages:
 *
 *   shortfallUnits = contracted − produced   (pro-rated across the supplier's
 *                                             agreements for that commodity)
 *   penaltyₐ       = shortfallUnits × unitPriceₐ × CONTRACT_SHORTFALL_PENALTY
 *   supplier `liquidCapital` −= penaltyₐ; buyer += penaltyₐ.
 *
 * The test is deliberately PRODUCTION, not delivery: units the supplier made
 * but could not move because the market did not want them are a demand problem,
 * not a breach, and the supplier already eats that loss as unsold inventory.
 * Same cash-conserving, equal-and-opposite shape as the premium leg above, and
 * the same `corp_supply_agreement` tx type, so nothing downstream needs to
 * learn a new ledger row.
 */

import {
  energyProductivityMultiplier,
  plantUtilizationForInputs,
} from "@/lib/corporations/rules/energyProductivityRamp";
import { substepMarker } from "@/lib/observability/phaseSubsteps";
import { ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  COMMODITY_BASE_PRICES,
  NATCORP_COMMODITY_MULTIPLIER,
  dollarsToUnits,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import { getInputMultiplier } from "@/lib/utils/productionPolicy";
import { safeUnitScale } from "@/lib/constants/capacityEconomy";
import {
  CONTRACT_DAMAGES_CAP_FRACTION,
  CONTRACT_SHORTFALL_PENALTY,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import {
  supplyAgreementRequiresState,
  supplyAgreementScopeKey,
} from "@/lib/market/commodityMarketScope";
import type { CorporationLookups } from "./types";
import type { TxThresholds } from "@/lib/db/types/financialTxLog";
import { emitTxBulk } from "@/lib/financialTxLog/emit";
import { partitionedBulkWrite } from "./partitionedBulkWrite";
import {
  resolveCorpLiquidCurrencyCode,
  fxRateForCorpFromMap,
  anchorToCorpCapital,
  corpCapitalToAnchor,
} from "@/lib/currency/corporationCapital";
import {
  MIN_SETTLE_ANCHOR,
  scopeOf,
  allocateDeliveriesToBuyers,
  type SettleableSupplyAgreement,
  type SettleCorpInfo,
  type TxInput,
  type SettledPremium,
  type SupplyAgreementDelivery,
  type SupplyAgreementDamages,
  type AchievableByCorpCommodity,
  type SupplyAgreementSettlements,
  type ByCorpScope,
  type SupplyAgreementDemandSector,
} from "./settleSupplyAgreementsAllocation";
export {
  addCorpToCorpSettlement,
  allocateDeliveriesToBuyers,
  computeDemandCappedContractReservations,
} from "./settleSupplyAgreementsAllocation";
export type {
  SettleableSupplyAgreement,
  SettleCorpInfo,
  SettledPremium,
  SupplyAgreementDelivery,
  SupplyAgreementDamages,
  AchievableByCorpCommodity,
  SupplyAgreementSettlements,
  SupplyAgreementDemandSector,
} from "./settleSupplyAgreementsAllocation";

/**
 * Measure corporation input consumption on the same unit basis as the world
 * commodity ledger. This is the buyer-side physical ceiling for private
 * agreement delivery and prevents a contract from creating phantom inventory.
 *
 * Keyed by {@link supplyAgreementScopeKey}. Every commodity is booked under
 * its bare key; a state-scoped commodity consumed by a located plant is ALSO
 * booked under `commodity@stateId`, which is the ceiling a state contract
 * delivers against.
 */
export function computeSupplyAgreementBuyerDemand(args: {
  preset?: string;
  sectors: readonly SupplyAgreementDemandSector[];
  currentTurn: number;
  unitScale: number;
  plantsEnabled: boolean;
}): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const unitScale = Number.isFinite(args.unitScale) && args.unitScale > 0 ? args.unitScale : 1;

  for (const sector of args.sectors) {
    if (args.plantsEnabled && sector.mothballed === true) continue;
    const rates = getEffectiveStrategyRatesForOperatingModel(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      args.currentTurn,
      sector.industryModel,
      sector.mediaDiscriminator,
      args.preset
    );
    const utilization =
      args.plantsEnabled &&
      typeof sector.producedUnits === "number" &&
      typeof sector.capacityUnits === "number" &&
      sector.capacityUnits > 0
        ? plantUtilizationForInputs(
            sector.producedUnits,
            sector.capacityUnits,
            energyProductivityMultiplier(sector.sectorType, args.currentTurn, args.preset)
          )
        : 1;
    const inputMultiplier = getInputMultiplier(sector.productionPolicyLevel ?? 0);
    const natcorpMultiplier = sector.isNatcorp ? NATCORP_COMMODITY_MULTIPLIER : 1;
    for (const [commodity, rate] of Object.entries(rates.demand ?? {}) as [
      CommodityType,
      number,
    ][]) {
      const basePrice = COMMODITY_BASE_PRICES[commodity];
      if (!(rate > 0) || !(basePrice > 0)) continue;
      const units =
        dollarsToUnits(Math.max(0, sector.revenueAnchor) * rate, basePrice) *
        unitScale *
        inputMultiplier *
        natcorpMultiplier *
        utilization;
      if (!(units > 0)) continue;
      const byKey = result.get(sector.corporationId) ?? new Map<string, number>();
      byKey.set(commodity, (byKey.get(commodity) ?? 0) + units);
      if (sector.stateId && supplyAgreementRequiresState(commodity)) {
        const stateKey = supplyAgreementScopeKey(commodity, sector.stateId);
        byKey.set(stateKey, (byKey.get(stateKey) ?? 0) + units);
      }
      result.set(sector.corporationId, byKey);
    }
  }

  return result;
}

/**
 * Pure settlement computation — no I/O. Given the active agreements, the units
 * that actually cleared per (supplier, commodity), lagged price ratios, and each
 * corp's currency/fx, returns the per-corp liquidCapital deltas and the ledger
 * rows. Cash conserves in ₳ by construction (equal-and-opposite legs).
 */
export function computeSupplyAgreementSettlements(args: {
  agreements: readonly SettleableSupplyAgreement[];
  /** Supplier corpId → scope key → contracted units that cleared. */
  contractSettlementByCorp: ByCorpScope;
  /**
   * Optional physical demand ceiling for each buyer. When present, agreements
   * cannot deliver or price more units than the buyer actually consumes.
   */
  buyerDemandByCorpCommodity?: ByCorpScope;
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  /**
   * The world's era unit-basis scale (`getEraUnitScale(preset)`). Contract
   * volumes are capacity units on the WORLD's unit basis; the per-unit price
   * below is the modern base price × ratio, so on an era basis (scale > 1,
   * where units are era-priced and 1/scale the modern size) the ₳ per unit
   * must shrink by the same factor or every settlement over-prices by the era
   * ratio. 1 for every modern world.
   */
  eraUnitScale: number;
  corpInfo: (corpId: string) => SettleCorpInfo | undefined;
  /**
   * Plants tier: supplier corpId → commodity → units that corp actually
   * PRODUCED this turn. Supplied only when plants is on; absent ⇒ no shortfall
   * penalties are assessed and settlement is byte-identical to before.
   *
   * A MISSING (supplier, commodity) entry means zero production, not "unknown":
   * see the mothball note at the read site below.
   */
  producedByCorpCommodity?: ByCorpScope;
  /**
   * Ticket #1147: what each supplier COULD have produced, given only the
   * constraints it does not control (input throughput, capital utilization, the
   * demand throttle, strike, disaster, nationalization transition, extraction
   * hard-min). The operator's own levers, the production-policy slider and
   * mothballing, are deliberately excluded, so choosing to cut output keeps
   * owing damages on the full contracted volume.
   *
   * The damages leg clamps the contracted obligation to this ceiling. Without
   * it, `volumeCap` is validated at signing against NAMEPLATE capacity while
   * the sink measures ACTUAL production, and every leg in between bills the
   * supplier 50% of a gap it was never physically able to close. That is what
   * drained a live logistics corp's entire balance every turn: legal at
   * signing, unreachable in practice, penalized forever.
   *
   * A MISSING (supplier, commodity) entry means "no ceiling known" and leaves
   * the obligation unclamped, i.e. the pre-fix behaviour. That is the state on
   * the first turn after deploy, before any sector has persisted the field.
   * It is NOT read as a zero ceiling, which would forgive every contract in
   * the world for one turn.
   */
  achievableByCorpCommodity?: AchievableByCorpCommodity;
  /**
   * Plants gate, required whenever `producedByCorpCommodity` is supplied.
   *
   * The production sink is filled from each sector's measured `producedUnits`,
   * scaled through `plantsSupplyScaledUnits`. That field only exists under
   * plants; below plants the only comparable figure is the revenue nameplate
   * after the lagged-supply normalization, which is not production at all and
   * would assess damages off a bookkeeping figure. Today the only caller gates
   * the sink on plants, but that gate lives far from here, so this function
   * refuses the sink itself rather than trusting a distant condition.
   *
   * It is deliberately NOT fed from clearing's offered `s.units`: extraction is
   * excluded from the plants offer and stays on the nameplate there, so routing
   * the sink through clearing would hand this guard a nameplate for the world's
   * dominant commodity supplier while still passing the plants check.
   */
  plantsEnabled?: boolean;
  turn: number;
  now: Date;
}): SupplyAgreementSettlements {
  const { agreements, contractSettlementByCorp, priceRatioByCommodity, corpInfo, turn, now } = args;

  // FIX 4 guard: hard-refuse a production sink that did not come from plants.
  const producedByCorpCommodity =
    args.producedByCorpCommodity && args.plantsEnabled === true
      ? args.producedByCorpCommodity
      : undefined;
  // Same plants gate as the production sink: the ceiling is built from the same
  // per-sector legs and is meaningless without them.
  const achievableByCorpCommodity =
    args.achievableByCorpCommodity && args.plantsEnabled === true
      ? args.achievableByCorpCommodity
      : undefined;
  if (args.producedByCorpCommodity && args.plantsEnabled !== true) {
    throw new Error(
      "computeSupplyAgreementSettlements: producedByCorpCommodity requires plantsEnabled — " +
        "outside plants those units are the post-normalization revenue nameplate, not production."
    );
  }
  if (args.achievableByCorpCommodity && args.plantsEnabled !== true) {
    throw new Error(
      "computeSupplyAgreementSettlements: achievableByCorpCommodity requires plantsEnabled"
    );
  }

  // Total contracted volume per (supplier, commodity), so a supplier's actually-
  // cleared units divide across its agreements pro-rata by their caps.
  const capByGroup = new Map<string, number>();
  for (const a of agreements) {
    const key = `${a.supplierCorpId}:${scopeOf(a)}`;
    capByGroup.set(key, (capByGroup.get(key) ?? 0) + a.volumeCap);
  }

  const deltaByCorp = new Map<string, number>();
  /** C6 solvency floor: ₳ each corp has already committed to pay this settlement. */
  const paidByCorp = new Map<string, number>();
  const txEntries: TxInput[] = [];
  const settledPremiums: SettledPremium[] = [];
  const deliveries: SupplyAgreementDelivery[] = [];
  const damages: SupplyAgreementDamages[] = [];
  const buyerAllocations = args.buyerDemandByCorpCommodity
    ? allocateDeliveriesToBuyers({
        agreements,
        contractSettlementByCorp,
        buyerDemandByCorpCommodity: args.buyerDemandByCorpCommodity,
      })
    : null;
  const obligationBySupplierCommodity = new Map<string, Map<string, number>>();
  for (const agreement of agreements) {
    const byKey =
      obligationBySupplierCommodity.get(agreement.supplierCorpId) ?? new Map<string, number>();
    const key = scopeOf(agreement);
    byKey.set(key, (byKey.get(key) ?? 0) + Math.max(0, agreement.volumeCap));
    obligationBySupplierCommodity.set(agreement.supplierCorpId, byKey);
  }
  const obligationAllocations = args.buyerDemandByCorpCommodity
    ? allocateDeliveriesToBuyers({
        agreements,
        contractSettlementByCorp: obligationBySupplierCommodity,
        buyerDemandByCorpCommodity: args.buyerDemandByCorpCommodity,
      })
    : null;
  type DamageAllocation = {
    achievableUnits?: number;
    creditedProductionUnits: number;
    shortfallUnits: number;
  };
  const damageByAgreement = new Map<number, DamageAllocation>();
  if (producedByCorpCommodity) {
    const agreementIndicesByGroup = new Map<string, number[]>();
    for (let index = 0; index < agreements.length; index++) {
      const agreement = agreements[index]!;
      if (agreement.shortfallEligible === false || agreement.volumeCap <= 0) continue;
      const key = `${agreement.supplierCorpId}:${scopeOf(agreement)}`;
      const indices = agreementIndicesByGroup.get(key) ?? [];
      indices.push(index);
      agreementIndicesByGroup.set(key, indices);
    }

    for (const indices of agreementIndicesByGroup.values()) {
      const first = agreements[indices[0]!]!;
      const obligations = indices.map((index) =>
        Math.max(
          0,
          obligationAllocations
            ? (obligationAllocations.get(index) ?? 0)
            : agreements[index]!.volumeCap
        )
      );
      const totalObligation = obligations.reduce((sum, units) => sum + units, 0);
      if (!(totalObligation > 0)) continue;

      const produced = Math.max(
        0,
        producedByCorpCommodity.get(first.supplierCorpId)?.get(scopeOf(first)) ?? 0
      );
      const achievableRaw = achievableByCorpCommodity
        ?.get(first.supplierCorpId)
        ?.get(scopeOf(first));
      const achievableKnown = typeof achievableRaw === "number" && Number.isFinite(achievableRaw);
      const effectiveObligation = achievableKnown
        ? Math.min(totalObligation, Math.max(0, achievableRaw))
        : totalObligation;
      const groupShortfall = Math.max(0, effectiveObligation - produced);

      for (let position = 0; position < indices.length; position++) {
        const index = indices[position]!;
        const share = obligations[position]! / totalObligation;
        const agreementEffective = effectiveObligation * share;
        const agreementShortfall = groupShortfall * share;
        damageByAgreement.set(index, {
          ...(achievableKnown ? { achievableUnits: agreementEffective } : {}),
          creditedProductionUnits: Math.max(0, agreementEffective - agreementShortfall),
          shortfallUnits: agreementShortfall,
        });
      }
    }
  }
  let settledCount = 0;
  let totalPremiumAnchor = 0;

  for (let agreementIndex = 0; agreementIndex < agreements.length; agreementIndex++) {
    const a = agreements[agreementIndex]!;
    if (a.volumeCap <= 0) continue;
    const filled = contractSettlementByCorp.get(a.supplierCorpId)?.get(scopeOf(a)) ?? 0;
    const totalCap = capByGroup.get(`${a.supplierCorpId}:${scopeOf(a)}`) ?? 0;
    if (totalCap <= 0) continue;
    const capShare = a.volumeCap / totalCap;

    const qty = buyerAllocations?.get(agreementIndex) ?? filled * capShare;
    // Held so the shortfall computed below can be written back onto it. The
    // record is pushed here, before any of the `continue` gates, because a
    // delivery happened whether or not the settlement wires cash.
    let deliveryRecord: SupplyAgreementDelivery | undefined;
    if (a.agreementId) {
      deliveryRecord = {
        agreementId: a.agreementId,
        supplierCorpId: a.supplierCorpId,
        buyerCorpId: a.buyerCorpId,
        commodity: a.commodity,
        contractedUnits: a.volumeCap,
        deliveredUnits: qty,
        turn,
        ...(args.buyerDemandByCorpCommodity
          ? {
              buyerConsumptionUnits: Math.max(
                0,
                args.buyerDemandByCorpCommodity.get(a.buyerCorpId)?.get(scopeOf(a)) ?? 0
              ),
            }
          : {}),
        ...(a.lastDeliveryTurn !== undefined && a.lastDeliveryTurn < turn
          ? {
              previousTurn: a.lastDeliveryTurn,
              previousDeliveredUnits: Math.max(0, a.lastDeliveredUnits ?? 0),
              ...(a.lastBuyerConsumptionUnits !== undefined
                ? { previousBuyerConsumptionUnits: Math.max(0, a.lastBuyerConsumptionUnits) }
                : {}),
            }
          : a.lastDeliveryTurn === turn && a.previousDeliveryTurn !== undefined
            ? {
                previousTurn: a.previousDeliveryTurn,
                previousDeliveredUnits: Math.max(0, a.previousDeliveredUnits ?? 0),
                ...(a.previousBuyerConsumptionUnits !== undefined
                  ? {
                      previousBuyerConsumptionUnits: Math.max(0, a.previousBuyerConsumptionUnits),
                    }
                  : {}),
              }
            : {}),
      };
      deliveries.push(deliveryRecord);
    }
    const unitPriceAnchor =
      ((COMMODITY_BASE_PRICES[a.commodity] ?? 0) / safeUnitScale(args.eraUnitScale)) *
      (priceRatioByCommodity.get(a.commodity) ?? 1);
    const premiumAnchor = filled > 0 ? qty * unitPriceAnchor * a.pricePremium : 0;

    // C5: record the priced position before any of the damages, solvency or
    // rounding gates below can drop this agreement from the settlement. The tax
    // position is created by the agreed price, not by whether the cash moved.
    if (a.agreementId && premiumAnchor !== 0 && Number.isFinite(premiumAnchor)) {
      settledPremiums.push({
        agreementId: a.agreementId,
        supplierCorpId: a.supplierCorpId,
        buyerCorpId: a.buyerCorpId,
        pricePremium: a.pricePremium,
        premiumAnchor,
      });
    }

    // Shortfall damages: the supplier under-PRODUCED against its contracted
    // volume. The sink as a whole is undefined outside plants ⇒ no penalty.
    //
    // A MISSING entry inside a supplied sink is ZERO produced, never "unknown".
    // Clearing only records sellers with units > 0, so a corp that mothballed
    // its plants (or made exactly 0 of the contracted commodity) has no entry.
    // Reading that as "no data ⇒ no damages" made mothballing strictly cheaper
    // than under-producing: make 1 unit and pay near-full damages, make 0 and
    // pay nothing. The whole contracted volume is the shortfall instead.
    //
    // `shortfallEligible === false` grandfathers a contract out of the damages
    // leg entirely: its `volumeCap` was never validated against anything the
    // plants could physically make, so a penalty on it would be arbitrary.
    // Compute damages once for the supplier's whole commodity book, then split
    // that one gap across eligible agreements. Delivery remains a max-flow
    // problem, but production is a supplier-level fact. Mixing max-flow output
    // with a pro-rata ceiling charged 50 units on a real 20-unit group gap.
    const damage = damageByAgreement.get(agreementIndex);
    const shortfallUnits = damage?.shortfallUnits ?? 0;
    // Tell the supplier what happened. Written even when the shortfall is zero
    // so the UI can distinguish "met the contract" from "never settled".
    if (deliveryRecord) {
      deliveryRecord.shortfallUnits = shortfallUnits;
      if (damage?.achievableUnits !== undefined) {
        deliveryRecord.achievableUnits = damage.achievableUnits;
      }
      if (damage) deliveryRecord.creditedProductionUnits = damage.creditedProductionUnits;
    }
    // C6 — DAMAGES ARE CAPPED AT A FRACTION OF THE CONTRACT'S OWN NOTIONAL.
    // Uncapped, this line is an unbounded wire between two consenting corps:
    // the pair that signs the contract also sets `volumeCap`, so two colluding
    // players could move any amount of cash, in either direction, every turn,
    // by contracting for a volume neither plant could ever make. The notional
    // is this contract's own `volumeCap × unit price` for the period, so the
    // ceiling scales with the deal actually struck and nothing else.
    const notionalAnchor = Math.max(0, a.volumeCap) * unitPriceAnchor;
    const uncappedPenaltyAnchor = shortfallUnits * unitPriceAnchor * CONTRACT_SHORTFALL_PENALTY;
    const penaltyAnchor = Math.min(
      uncappedPenaltyAnchor,
      notionalAnchor * CONTRACT_DAMAGES_CAP_FRACTION
    );
    if (deliveryRecord) deliveryRecord.penaltyAnchor = penaltyAnchor;

    // Supplier's net position: it is credited the premium and debited damages.
    const rawNetAnchor = premiumAnchor - penaltyAnchor;
    if (!Number.isFinite(rawNetAnchor) || Math.abs(rawNetAnchor) < MIN_SETTLE_ANCHOR) continue;

    const supplier = corpInfo(a.supplierCorpId);
    const buyer = corpInfo(a.buyerCorpId);
    if (!supplier || !buyer) continue;

    // C6 — SOLVENCY FLOOR. Whichever side is NET PAYING pays what it has and no
    // more; the unpaid remainder is logged, not wired. `paidByCorp` tracks the
    // running spend inside this settlement so a corp with ten contracts cannot
    // pay its whole balance ten times over.
    const payerId = rawNetAnchor < 0 ? a.supplierCorpId : a.buyerCorpId;
    const payer = rawNetAnchor < 0 ? supplier : buyer;
    const owedAnchor = Math.abs(rawNetAnchor);
    let netAnchor = rawNetAnchor;
    let unpaidAnchor = 0;
    if (
      typeof payer.liquidCapitalAnchor === "number" &&
      Number.isFinite(payer.liquidCapitalAnchor)
    ) {
      const available = Math.max(0, payer.liquidCapitalAnchor - (paidByCorp.get(payerId) ?? 0));
      const payable = Math.min(owedAnchor, available);
      unpaidAnchor = owedAnchor - payable;
      if (deliveryRecord && unpaidAnchor > 0) {
        deliveryRecord.unpaidSettlementAnchor = unpaidAnchor;
      }
      paidByCorp.set(payerId, (paidByCorp.get(payerId) ?? 0) + payable);
      netAnchor = rawNetAnchor < 0 ? -payable : payable;
      if (Math.abs(netAnchor) < MIN_SETTLE_ANCHOR) {
        // Nothing wired, but the OWED damages are exactly what the paying CEO
        // needs to see. Record before dropping the settlement.
        if (shortfallUnits > 0 && penaltyAnchor >= MIN_SETTLE_ANCHOR) {
          damages.push({
            agreementId: a.agreementId,
            supplierCorpId: a.supplierCorpId,
            buyerCorpId: a.buyerCorpId,
            commodity: a.commodity,
            contractedUnits: Math.max(0, a.volumeCap),
            producedUnits: damage?.creditedProductionUnits,
            shortfallUnits,
            penaltyAnchor: 0,
            unpaidAnchor,
          });
        }
        continue;
      }
    }

    // Ticket #1147: report assessed damages even when the premium nets them
    // away on this agreement — the CEO still owes capacity against a signed
    // volume and the next turn will charge it again.
    if (shortfallUnits > 0 && penaltyAnchor >= MIN_SETTLE_ANCHOR) {
      damages.push({
        agreementId: a.agreementId,
        supplierCorpId: a.supplierCorpId,
        buyerCorpId: a.buyerCorpId,
        commodity: a.commodity,
        contractedUnits: Math.max(0, a.volumeCap),
        producedUnits: damage?.creditedProductionUnits,
        shortfallUnits,
        penaltyAnchor,
        unpaidAnchor,
      });
    }

    const supplierLocal = Math.round(anchorToCorpCapital(netAnchor, supplier.ccy, supplier.fxRate));
    const buyerLocal = Math.round(anchorToCorpCapital(netAnchor, buyer.ccy, buyer.fxRate));
    if (!Number.isFinite(supplierLocal) || !Number.isFinite(buyerLocal)) continue;
    if (supplierLocal === 0 && buyerLocal === 0) continue;
    if (deliveryRecord) {
      deliveryRecord.supplierCashDeltaLocal = supplierLocal;
      deliveryRecord.supplierCurrencyCode = supplier.ccy;
      deliveryRecord.buyerCashDeltaLocal = -buyerLocal;
      deliveryRecord.buyerCurrencyCode = buyer.ccy;
    }

    // Supplier is credited its net position; buyer is debited it (each in its
    // own ccy). A net-negative position (damages exceeding the premium) simply
    // reverses the direction of both legs.
    deltaByCorp.set(a.supplierCorpId, (deltaByCorp.get(a.supplierCorpId) ?? 0) + supplierLocal);
    deltaByCorp.set(a.buyerCorpId, (deltaByCorp.get(a.buyerCorpId) ?? 0) - buyerLocal);
    settledCount++;
    totalPremiumAnchor += premiumAnchor;

    const meta = {
      ...(a.agreementId ? { agreementId: a.agreementId } : {}),
      commodity: a.commodity,
      unitsSettled: Math.round(qty),
      pricePremium: a.pricePremium,
      premiumAnchor: Math.round(premiumAnchor),
      ...(shortfallUnits > 0
        ? {
            shortfallUnits: Math.round(shortfallUnits),
            shortfallPenaltyAnchor: Math.round(penaltyAnchor),
            ...(uncappedPenaltyAnchor > penaltyAnchor
              ? { damagesCappedFromAnchor: Math.round(uncappedPenaltyAnchor) }
              : {}),
          }
        : {}),
      ...(unpaidAnchor >= MIN_SETTLE_ANCHOR
        ? { unpaidDamagesAnchor: Math.round(unpaidAnchor) }
        : {}),
    };
    if (supplier.ccy) {
      txEntries.push({
        type: "corp_supply_agreement",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: supplier._id,
        subjectName: supplier.name,
        amount: supplierLocal,
        currencyCode: supplier.ccy,
        counterpartyType: "corporation",
        counterpartyId: buyer._id,
        meta: { ...meta, counterpartyCorpId: a.buyerCorpId },
      });
    }
    if (buyer.ccy) {
      txEntries.push({
        type: "corp_supply_agreement",
        turn,
        createdAt: now,
        subjectType: "corporation",
        subjectId: buyer._id,
        subjectName: buyer.name,
        amount: -buyerLocal,
        currencyCode: buyer.ccy,
        counterpartyType: "corporation",
        counterpartyId: supplier._id,
        meta: { ...meta, counterpartyCorpId: a.supplierCorpId },
      });
    }
  }

  return {
    deltaByCorp,
    txEntries,
    settledCount,
    totalPremiumAnchor,
    settledPremiums,
    deliveries,
    damages,
  };
}

/** I/O wrapper: compute settlements from lookups, then apply them to the DB. */
export async function settleSupplyAgreements(args: {
  db: Db;
  lookups: CorporationLookups;
  agreements: SettleableSupplyAgreement[];
  contractSettlementByCorp: ByCorpScope;
  /** Buyer demand ceiling used to assign delivered units to counterparties. */
  buyerDemandByCorpCommodity?: ByCorpScope;
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  /** Plants tier: supplier corpId -> scope key -> units actually produced. */
  producedByCorpCommodity?: ByCorpScope;
  /** Plants tier: supplier corpId -> commodity -> involuntary-constraint ceiling (#1147). */
  achievableByCorpCommodity?: AchievableByCorpCommodity;
  /** Required alongside `producedByCorpCommodity` — see the guard in the pure fn. */
  plantsEnabled?: boolean;
  turn: number;
  now: Date;
  thresholds: TxThresholds;
}): Promise<{
  settledCount: number;
  totalPremiumAnchor: number;
  settledPremiums: SettledPremium[];
  deliveries: SupplyAgreementDelivery[];
  damages: SupplyAgreementDamages[];
}> {
  const step = substepMarker();
  const { db, lookups, agreements, contractSettlementByCorp, priceRatioByCommodity, turn, now } =
    args;
  if (agreements.length === 0)
    return {
      settledCount: 0,
      totalPremiumAnchor: 0,
      settledPremiums: [],
      deliveries: [],
      damages: [],
    };

  // Income, dividends and other corporation-turn writes have already landed in
  // MongoDB, while `lookups.corpById` is the pre-turn snapshot. The solvency
  // floor must use the balance that actually exists at settlement time. Using
  // the stale lookup made damages depend on whether the player spent yesterday's
  // cash, exactly the behavior reported in ticket #1147.
  const participantIds = [
    ...new Set(
      agreements.flatMap((agreement) => [agreement.supplierCorpId, agreement.buyerCorpId])
    ),
  ].filter(ObjectId.isValid);
  const freshCapitalByCorpId = new Map<string, number>();
  if (participantIds.length > 0) {
    const currentBalances = await db
      .collection<Pick<Corporation, "_id" | "liquidCapital">>("corporations")
      .find(
        { _id: { $in: participantIds.map((id) => new ObjectId(id)) } },
        { projection: { liquidCapital: 1 } }
      )
      .toArray();
    for (const current of currentBalances) {
      freshCapitalByCorpId.set(current._id.toString(), current.liquidCapital ?? 0);
    }
  }

  step.mark("settle.balances");

  const {
    deltaByCorp,
    txEntries,
    settledCount,
    totalPremiumAnchor,
    settledPremiums,
    deliveries,
    damages,
  } = computeSupplyAgreementSettlements({
    agreements,
    contractSettlementByCorp,
    buyerDemandByCorpCommodity: args.buyerDemandByCorpCommodity,
    priceRatioByCommodity,
    eraUnitScale: lookups.eraUnitScale,
    producedByCorpCommodity: args.producedByCorpCommodity,
    achievableByCorpCommodity: args.achievableByCorpCommodity,
    plantsEnabled: args.plantsEnabled,
    corpInfo: (corpId) => {
      const corp = lookups.corpById.get(corpId);
      if (!corp) return undefined;
      return {
        _id: corp._id,
        name: corp.name,
        ccy: resolveCorpLiquidCurrencyCode(corp),
        fxRate: fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency),
        // C6 solvency floor: the payer's own balance, in ₳.
        liquidCapitalAnchor: corpCapitalToAnchor(
          freshCapitalByCorpId.get(corpId) ?? corp.liquidCapital ?? 0,
          resolveCorpLiquidCurrencyCode(corp),
          fxRateForCorpFromMap(corp, lookups.exchangeRatesByCurrency)
        ),
      };
    },
    turn,
    now,
  });

  step.mark("settle.compute");

  if (deltaByCorp.size > 0) {
    const ops: AnyBulkWriteOperation<Corporation>[] = [];
    for (const [corpId, delta] of deltaByCorp) {
      if (delta === 0) continue;
      const corp = lookups.corpById.get(corpId);
      if (!corp) continue;
      ops.push({
        updateOne: {
          filter: { _id: corp._id },
          update: { $inc: { liquidCapital: delta }, $set: { updatedAt: now } },
        },
      });
      // Keep the in-memory snapshot consistent for any later same-turn reader.
      corp.liquidCapital = (freshCapitalByCorpId.get(corpId) ?? corp.liquidCapital ?? 0) + delta;
    }
    if (ops.length > 0) await db.collection<Corporation>("corporations").bulkWrite(ops);
  }
  step.mark("settle.corpWrites");
  if (deliveries.length > 0) {
    const deliveryOps: AnyBulkWriteOperation<SupplyAgreement>[] = [];
    for (const delivery of deliveries) {
      if (!ObjectId.isValid(delivery.agreementId)) continue;
      const setFields = {
        lastDeliveryTurn: delivery.turn,
        lastDeliveredUnits: delivery.deliveredUnits,
        ...(delivery.buyerConsumptionUnits !== undefined
          ? { lastBuyerConsumptionUnits: delivery.buyerConsumptionUnits }
          : {}),
        ...(delivery.previousTurn !== undefined
          ? { previousDeliveryTurn: delivery.previousTurn }
          : {}),
        ...(delivery.previousDeliveredUnits !== undefined
          ? { previousDeliveredUnits: delivery.previousDeliveredUnits }
          : {}),
        ...(delivery.previousBuyerConsumptionUnits !== undefined
          ? { previousBuyerConsumptionUnits: delivery.previousBuyerConsumptionUnits }
          : {}),
        lastShortfallUnits: Math.round(delivery.shortfallUnits ?? 0),
        lastShortfallPenaltyAnchor: Math.round(delivery.penaltyAnchor ?? 0),
        lastSupplierCashDelta: delivery.supplierCashDeltaLocal ?? 0,
        lastBuyerCashDelta: delivery.buyerCashDeltaLocal ?? 0,
        lastUnpaidSettlementAnchor: Math.round(delivery.unpaidSettlementAnchor ?? 0),
        ...(delivery.achievableUnits !== undefined
          ? { lastAchievableUnits: Math.round(delivery.achievableUnits) }
          : {}),
        ...(delivery.creditedProductionUnits !== undefined
          ? { lastCreditedProductionUnits: Math.round(delivery.creditedProductionUnits) }
          : {}),
        ...(delivery.supplierCurrencyCode
          ? { lastSupplierCashCurrency: delivery.supplierCurrencyCode }
          : {}),
        ...(delivery.buyerCurrencyCode
          ? { lastBuyerCashCurrency: delivery.buyerCurrencyCode }
          : {}),
        updatedAt: now,
      };
      const unsetFields: Partial<
        Record<
          | "lastAchievableUnits"
          | "lastCreditedProductionUnits"
          | "lastSupplierCashCurrency"
          | "lastBuyerCashCurrency",
          ""
        >
      > = {
        ...(delivery.achievableUnits === undefined ? { lastAchievableUnits: "" } : {}),
        ...(delivery.creditedProductionUnits === undefined
          ? { lastCreditedProductionUnits: "" }
          : {}),
        ...(!delivery.supplierCurrencyCode ? { lastSupplierCashCurrency: "" } : {}),
        ...(!delivery.buyerCurrencyCode ? { lastBuyerCashCurrency: "" } : {}),
      };
      deliveryOps.push({
        updateOne: {
          filter: { _id: new ObjectId(delivery.agreementId) },
          update: {
            $set: setFields,
            ...(Object.keys(unsetFields).length > 0 ? { $unset: unsetFields } : {}),
          },
        },
      });
    }
    // One op per live agreement (~27k on a mature world), each keyed by its
    // own `_id`, so the batches can be applied side by side.
    await partitionedBulkWrite(db.collection<SupplyAgreement>("supplyAgreements"), deliveryOps);
  }
  step.mark("settle.deliveryWrites");
  if (txEntries.length > 0) await emitTxBulk(db, txEntries, args.thresholds);
  step.mark("settle.ledger");
  await notifySupplyAgreementDamages({ db, damages, agreements, lookups, turn });
  step.mark("settle.notify");

  return { settledCount, totalPremiumAnchor, settledPremiums, deliveries, damages };
}

/**
 * Turns between damages notices for the SAME agreement.
 *
 * Damages are a LEVEL condition, not an edge: a contract whose volume cap sits
 * above what the plants can achieve is charged every single turn until the
 * owner resizes it. Notifying on every charge would put the same line in the
 * inbox daily, per agreement, forever — the `extraction_capacity_bound`
 * precedent this follows only fires on sectors that NEWLY bind. A cooldown
 * keeps the first charge loud and the reminder periodic.
 */
const DAMAGES_NOTICE_COOLDOWN_TURNS = 12;

/**
 * Ticket #1147: tell a player-owned supplier's owner when its contract charged
 * shortfall damages. The penalty leg settles silently while the income
 * statement still shows a healthy per-turn profit — the reporting player's
 * cash sat flat for days with no signal anywhere that a signed volume cap was
 * eating the entire profit every turn. NPP/state corps (no real user) are
 * skipped; best-effort like every other notification in the turn pipeline.
 */
async function notifySupplyAgreementDamages(args: {
  db: Db;
  damages: readonly SupplyAgreementDamages[];
  agreements: readonly SettleableSupplyAgreement[];
  lookups: CorporationLookups;
  turn: number;
}): Promise<void> {
  if (args.damages.length === 0) return;
  const ZERO_USER = "000000000000000000000000";
  // Cooldown gate. An agreement with no recorded notice has never been
  // reported and always notifies; after that it waits out the cooldown so a
  // permanently oversized contract does not file a daily inbox item.
  const lastNoticeByAgreement = new Map<string, number>();
  for (const a of args.agreements) {
    if (a.agreementId !== undefined && a.lastDamagesNoticeTurn !== undefined) {
      lastNoticeByAgreement.set(a.agreementId, a.lastDamagesNoticeTurn);
    }
  }
  const notifiedAgreementIds: string[] = [];
  const due = args.damages.filter((d) => {
    if (d.agreementId === undefined) return true;
    const last = lastNoticeByAgreement.get(d.agreementId);
    if (last !== undefined && args.turn - last < DAMAGES_NOTICE_COOLDOWN_TURNS) return false;
    notifiedAgreementIds.push(d.agreementId);
    return true;
  });
  if (due.length === 0) return;
  const notifications = due.flatMap((d) => {
    const supplier = args.lookups.corpById.get(d.supplierCorpId);
    const buyer = args.lookups.corpById.get(d.buyerCorpId);
    const userId = supplier?.userId;
    if (!supplier || !buyer || !userId || userId.toString() === ZERO_USER) return [];
    const paid = Math.round(d.penaltyAnchor);
    const unpaid = Math.round(d.unpaidAnchor);
    return [
      {
        userId,
        type: "corp_supply_agreement_damages" as const,
        title: "Supply contract shortfall damages",
        message:
          `${supplier.name} delivered ${Math.round(d.contractedUnits - d.shortfallUnits)} of ` +
          `${Math.round(d.contractedUnits)} contracted ${d.commodity} units and was charged ` +
          `₳${paid.toLocaleString()} in shortfall damages (paid to ${buyer.name}` +
          (unpaid > 0 ? `, ₳${unpaid.toLocaleString()} unpaid` : "") +
          "). Raise production or renegotiate the contract's volume to stop the bleed.",
        metadata: {
          corporationId: d.supplierCorpId,
          counterpartyCorpId: d.buyerCorpId,
          agreementId: d.agreementId,
          commodity: d.commodity,
          contractedUnits: Math.round(d.contractedUnits),
          producedUnits: d.producedUnits !== undefined ? Math.round(d.producedUnits) : undefined,
          shortfallUnits: Math.round(d.shortfallUnits),
          penaltyAnchor: paid,
          unpaidAnchor: unpaid,
          turn: args.turn,
        },
      },
    ];
  });
  if (notifications.length === 0) return;
  try {
    const { createNotifications } = await import("@/lib/notifications");
    await createNotifications(notifications);
  } catch (err) {
    console.error("[settleSupplyAgreements] damage notifications failed:", err);
    return;
  }
  // Stamp the cooldown only after the notices actually went out, so a failed
  // send is retried next turn rather than silently starting the cooldown.
  const stampIds = notifiedAgreementIds.filter((id) => ObjectId.isValid(id));
  if (stampIds.length === 0) return;
  try {
    await args.db
      .collection<SupplyAgreement>("supplyAgreements")
      .updateMany(
        { _id: { $in: stampIds.map((id) => new ObjectId(id)) } },
        { $set: { lastDamagesNoticeTurn: args.turn } }
      );
  } catch (err) {
    console.error("[settleSupplyAgreements] damage notice cooldown stamp failed:", err);
  }
}
