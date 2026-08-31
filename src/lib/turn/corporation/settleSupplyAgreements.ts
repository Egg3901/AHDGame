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

import { ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import type { Corporation } from "@/lib/db/types";
import type { CommodityType } from "@/lib/constants/commodities";
import {
  COMMODITY_BASE_PRICES,
  NATCORP_COMMODITY_MULTIPLIER,
  dollarsToUnits,
} from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { getInputMultiplier } from "@/lib/utils/productionPolicy";
import { safeUnitScale } from "@/lib/constants/capacityEconomy";
import {
  CONTRACT_DAMAGES_CAP_FRACTION,
  CONTRACT_SHORTFALL_PENALTY,
  type SupplyAgreement,
} from "@/lib/db/types/supplyAgreement";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationLookups } from "./types";
import type { TxThresholds, FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { emitTxBulk } from "@/lib/financialTxLog/emit";
import {
  resolveCorpLiquidCurrencyCode,
  fxRateForCorpFromMap,
  anchorToCorpCapital,
  corpCapitalToAnchor,
} from "@/lib/currency/corporationCapital";

export interface SettleableSupplyAgreement {
  /**
   * Agreement document id. Optional so every existing caller and test compiles
   * unchanged; the transfer-pricing accrual (C5) simply skips a position it
   * cannot key.
   */
  agreementId?: string;
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  /** Contracted units on the DAILY basis, matching sector capacity (clamped ≥ 0). */
  volumeCap: number;
  /** Price offset vs market, already clamped to ±SUPPLY_AGREEMENT_PRICE_BAND. */
  pricePremium: number;
  /**
   * Grandfather gate for the shortfall leg. `false` marks a contract signed
   * before the propose-time validator had any physical basis for `volumeCap`
   * (pre-plants), so damages must NOT be assessed on it — the supplier never
   * agreed to a number its plants were sized against. Absent/undefined means
   * "assess", which keeps every existing caller and test unchanged.
   */
  shortfallEligible?: boolean;
  lastDeliveryTurn?: number;
  lastDeliveredUnits?: number;
  lastBuyerConsumptionUnits?: number;
  previousDeliveryTurn?: number;
  previousDeliveredUnits?: number;
  previousBuyerConsumptionUnits?: number;
}

/** Per-corp economic identity the pure settlement needs (id, name, ccy, fx). */
export interface SettleCorpInfo {
  _id: ObjectId;
  name: string;
  ccy: CurrencyCode | undefined;
  fxRate: number;
  /**
   * The corp's liquid capital, in ₳ — the SOLVENCY FLOOR for damages (C6).
   *
   * Settlement `$inc`s a corp's balance with no lower bound, so an uncapped
   * damages leg could drive a supplier straight through zero and credit the
   * buyer cash that never existed. A payer pays what it HAS; the remainder is
   * logged as an unpaid shortfall, not wired.
   *
   * Optional so existing callers/tests that do not resolve balances keep the
   * pre-C6 behaviour (no floor) rather than silently settling everything to 0.
   */
  liquidCapitalAnchor?: number;
}

/**
 * Add one equal-and-opposite corporation cash transfer to an accumulator.
 *
 * Conversion deliberately remains unrounded here. Callers that fan one payer
 * out across many recipients must aggregate all of a corporation's legs before
 * rounding, otherwise every sub-unit pair can disappear independently.
 */
export function addCorpToCorpSettlement(
  deltaByCorp: Map<string, number>,
  payerCorpId: string,
  payer: SettleCorpInfo,
  recipientCorpId: string,
  recipient: SettleCorpInfo,
  amountAnchor: number
): void {
  if (!(Number.isFinite(amountAnchor) && amountAnchor > 0)) return;
  const payerLocal = anchorToCorpCapital(amountAnchor, payer.ccy, payer.fxRate);
  const recipientLocal = anchorToCorpCapital(amountAnchor, recipient.ccy, recipient.fxRate);
  if (!(Number.isFinite(payerLocal) && Number.isFinite(recipientLocal))) return;
  deltaByCorp.set(payerCorpId, (deltaByCorp.get(payerCorpId) ?? 0) - payerLocal);
  deltaByCorp.set(recipientCorpId, (deltaByCorp.get(recipientCorpId) ?? 0) + recipientLocal);
}

type TxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

/** One agreement's settled price premium, for the C5 transfer-pricing accrual. */
export interface SettledPremium {
  agreementId: string;
  supplierCorpId: string;
  buyerCorpId: string;
  pricePremium: number;
  /** Signed ₳ premium from the supplier's view: positive = buyer paid it. */
  premiumAnchor: number;
}

/** Buyer-visible physical outcome for one agreement in one turn. */
export interface SupplyAgreementDelivery {
  agreementId: string;
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  contractedUnits: number;
  deliveredUnits: number;
  turn: number;
  buyerConsumptionUnits?: number;
  previousTurn?: number;
  previousDeliveredUnits?: number;
  previousBuyerConsumptionUnits?: number;
  /**
   * Ticket #1147: why the supplier was charged, persisted so the corporation
   * UI can say it in words instead of the player watching cash vanish. A
   * shortfall with no explanation is what made this bug unreadable: the
   * reporter saw "120k profit became 119k" and had no way to connect it to a
   * contract they signed turns earlier.
   *
   * `achievableUnits` is the involuntary-constraint ceiling used to clamp the
   * obligation; when it sits below `contractedUnits` the contract is asking
   * for more than the plants can currently make, which is the single most
   * useful thing a supplier can be told.
   */
  shortfallUnits?: number;
  achievableUnits?: number;
  creditedProductionUnits?: number;
  penaltyAnchor?: number;
  supplierCashDeltaLocal?: number;
  supplierCurrencyCode?: CurrencyCode;
  unpaidSettlementAnchor?: number;
}

/**
 * Ticket #1147: shortfall damages assessed on one agreement in one turn.
 *
 * Damages are a large, recurring, and previously INVISIBLE cash drain: the
 * penalty leg settles silently while the corp's income statement still shows
 * a healthy per-turn profit, so a CEO whose plants under-produce against a
 * signed volume sees cash stay flat forever with no explanation anywhere in
 * the UI. Reported alongside deliveries so the turn phase can notify the
 * paying corp's owner.
 */
export interface SupplyAgreementDamages {
  agreementId?: string;
  supplierCorpId: string;
  buyerCorpId: string;
  commodity: CommodityType;
  contractedUnits: number;
  producedUnits: number | undefined;
  shortfallUnits: number;
  /** Damages wired this turn, in ₳ (after the C6 notional cap). */
  penaltyAnchor: number;
  /** Damages owed but NOT wired because the payer hit its solvency floor, in ₳. */
  unpaidAnchor: number;
}

export type AchievableByCorpCommodity = ReadonlyMap<
  string,
  ReadonlyMap<CommodityType, number | null>
>;

export interface SupplyAgreementSettlements {
  /** corpId → net liquidCapital delta (in that corp's currency). */
  deltaByCorp: Map<string, number>;
  txEntries: TxInput[];
  settledCount: number;
  totalPremiumAnchor: number;
  /**
   * Per-agreement premium detail. Reported for every agreement that priced off
   * market, INCLUDING ones whose net settlement was suppressed by the solvency
   * floor: the tax position exists because the price was agreed, not because
   * the cash cleared.
   */
  settledPremiums: SettledPremium[];
  /** Per-agreement quantities delivered to the named buyer this turn. */
  deliveries: SupplyAgreementDelivery[];
  /** Per-agreement shortfall damages assessed this turn (see the type doc). */
  damages: SupplyAgreementDamages[];
}

/** Below this ₳ magnitude a settlement is not worth a write. */
const MIN_SETTLE_ANCHOR = 1;

type DeliveryFlowEdge = {
  to: number;
  reverseIndex: number;
  capacity: number;
  originalCapacity: number;
};

function demandCappedAgreementWeights(args: {
  agreements: readonly SettleableSupplyAgreement[];
  buyerDemandByCorpCommodity: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
}): Map<number, number> {
  const totalCapByBuyerCommodity = new Map<string, number>();
  for (const agreement of args.agreements) {
    const key = `${agreement.buyerCorpId}:${agreement.commodity}`;
    totalCapByBuyerCommodity.set(
      key,
      (totalCapByBuyerCommodity.get(key) ?? 0) + Math.max(0, agreement.volumeCap)
    );
  }

  const weights = new Map<number, number>();
  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    const cap = Math.max(0, agreement.volumeCap);
    const totalCap = totalCapByBuyerCommodity.get(
      `${agreement.buyerCorpId}:${agreement.commodity}`
    );
    if (!(cap > 0) || !(totalCap && totalCap > 0)) continue;
    const demand = Math.max(
      0,
      args.buyerDemandByCorpCommodity.get(agreement.buyerCorpId)?.get(agreement.commodity) ?? 0
    );
    const weight = cap * Math.min(1, demand / totalCap);
    if (weight > 0) weights.set(index, weight);
  }
  return weights;
}

/**
 * Keep the max-flow total, then remove its database-order bias where buyer
 * demand leaves room to do so. A supplier short of two otherwise viable
 * commitments must share what it delivered by their demand-capped sizes, not
 * give the first Mongo row everything and the second row zero.
 */
function rebalanceDeliveriesProRata(args: {
  agreements: readonly SettleableSupplyAgreement[];
  deliveredByAgreement: Map<number, number>;
  buyerDemandByCorpCommodity: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
}): void {
  const weights = demandCappedAgreementWeights(args);
  const deliveredByBuyerCommodity = new Map<string, number>();
  const indicesBySupplierCommodity = new Map<string, number[]>();

  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    const delivered = args.deliveredByAgreement.get(index) ?? 0;
    const buyerKey = `${agreement.buyerCorpId}:${agreement.commodity}`;
    deliveredByBuyerCommodity.set(
      buyerKey,
      (deliveredByBuyerCommodity.get(buyerKey) ?? 0) + delivered
    );
    const supplierKey = `${agreement.supplierCorpId}:${agreement.commodity}`;
    const indices = indicesBySupplierCommodity.get(supplierKey) ?? [];
    indices.push(index);
    indicesBySupplierCommodity.set(supplierKey, indices);
  }

  for (const indices of indicesBySupplierCommodity.values()) {
    const deliveredTotal = indices.reduce(
      (sum, index) => sum + (args.deliveredByAgreement.get(index) ?? 0),
      0
    );
    const weightTotal = indices.reduce((sum, index) => sum + (weights.get(index) ?? 0), 0);
    if (!(deliveredTotal > 0) || !(weightTotal > 0)) continue;

    const targets = new Map(
      indices.map((index) => [index, deliveredTotal * ((weights.get(index) ?? 0) / weightTotal)])
    );
    const donors = indices
      .filter(
        (index) => (args.deliveredByAgreement.get(index) ?? 0) - (targets.get(index) ?? 0) > 1e-9
      )
      .sort((left, right) =>
        (args.agreements[left]!.agreementId ?? String(left)).localeCompare(
          args.agreements[right]!.agreementId ?? String(right)
        )
      );
    const recipients = indices
      .filter(
        (index) => (targets.get(index) ?? 0) - (args.deliveredByAgreement.get(index) ?? 0) > 1e-9
      )
      .sort((left, right) =>
        (args.agreements[left]!.agreementId ?? String(left)).localeCompare(
          args.agreements[right]!.agreementId ?? String(right)
        )
      );

    for (const recipientIndex of recipients) {
      const recipient = args.agreements[recipientIndex]!;
      const recipientBuyerKey = `${recipient.buyerCorpId}:${recipient.commodity}`;
      let recipientNeed =
        (targets.get(recipientIndex) ?? 0) - (args.deliveredByAgreement.get(recipientIndex) ?? 0);

      for (const donorIndex of donors) {
        if (!(recipientNeed > 1e-9)) break;
        const donor = args.agreements[donorIndex]!;
        const donorExcess =
          (args.deliveredByAgreement.get(donorIndex) ?? 0) - (targets.get(donorIndex) ?? 0);
        if (!(donorExcess > 1e-9)) continue;

        const sameBuyer = donor.buyerCorpId === recipient.buyerCorpId;
        const buyerDemand = Math.max(
          0,
          args.buyerDemandByCorpCommodity.get(recipient.buyerCorpId)?.get(recipient.commodity) ?? 0
        );
        const buyerRoom = sameBuyer
          ? Number.POSITIVE_INFINITY
          : Math.max(0, buyerDemand - (deliveredByBuyerCommodity.get(recipientBuyerKey) ?? 0));
        const agreementRoom = Math.max(
          0,
          recipient.volumeCap - (args.deliveredByAgreement.get(recipientIndex) ?? 0)
        );
        const shifted = Math.min(recipientNeed, donorExcess, buyerRoom, agreementRoom);
        if (!(shifted > 1e-9)) continue;

        args.deliveredByAgreement.set(
          donorIndex,
          (args.deliveredByAgreement.get(donorIndex) ?? 0) - shifted
        );
        args.deliveredByAgreement.set(
          recipientIndex,
          (args.deliveredByAgreement.get(recipientIndex) ?? 0) + shifted
        );
        recipientNeed -= shifted;
        if (!sameBuyer) {
          const donorBuyerKey = `${donor.buyerCorpId}:${donor.commodity}`;
          deliveredByBuyerCommodity.set(
            donorBuyerKey,
            (deliveredByBuyerCommodity.get(donorBuyerKey) ?? 0) - shifted
          );
          deliveredByBuyerCommodity.set(
            recipientBuyerKey,
            (deliveredByBuyerCommodity.get(recipientBuyerKey) ?? 0) + shifted
          );
        }
      }
    }
  }
}

/**
 * Allocate the delivered supplier totals to named buyers without exceeding an
 * agreement cap or the buyer's physical demand. This is a small max-flow graph
 * per commodity: source -> supplier -> agreement -> buyer -> sink.
 */
function allocateDeliveriesToBuyers(args: {
  agreements: readonly SettleableSupplyAgreement[];
  contractSettlementByCorp: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  buyerDemandByCorpCommodity: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
}): Map<number, number> {
  const deliveredByAgreement = new Map<number, number>();
  const commodities = [...new Set(args.agreements.map((agreement) => agreement.commodity))];

  for (const commodity of commodities) {
    const indexed = args.agreements
      .map((agreement, index) => ({ agreement, index }))
      .filter(({ agreement }) => agreement.commodity === commodity && agreement.volumeCap > 0)
      .sort((left, right) =>
        (left.agreement.agreementId ?? String(left.index)).localeCompare(
          right.agreement.agreementId ?? String(right.index)
        )
      );
    if (indexed.length === 0) continue;

    const suppliers = [...new Set(indexed.map(({ agreement }) => agreement.supplierCorpId))];
    const buyers = [...new Set(indexed.map(({ agreement }) => agreement.buyerCorpId))];
    const source = 0;
    let nextNode = 1;
    const supplierNode = new Map(suppliers.map((id) => [id, nextNode++]));
    const agreementNode = new Map(indexed.map(({ index }) => [index, nextNode++]));
    const buyerNode = new Map(buyers.map((id) => [id, nextNode++]));
    const sink = nextNode++;
    const graph: DeliveryFlowEdge[][] = Array.from({ length: nextNode }, () => []);

    const addEdge = (from: number, to: number, capacity: number): DeliveryFlowEdge => {
      const forward: DeliveryFlowEdge = {
        to,
        reverseIndex: graph[to]!.length,
        capacity,
        originalCapacity: capacity,
      };
      const reverse: DeliveryFlowEdge = {
        to: from,
        reverseIndex: graph[from]!.length,
        capacity: 0,
        originalCapacity: 0,
      };
      graph[from]!.push(forward);
      graph[to]!.push(reverse);
      return forward;
    };

    for (const supplier of suppliers) {
      const available = args.contractSettlementByCorp.get(supplier)?.get(commodity) ?? 0;
      addEdge(source, supplierNode.get(supplier)!, Math.max(0, available));
    }

    const deliveryEdgeByAgreement = new Map<number, DeliveryFlowEdge>();
    for (const { agreement, index } of indexed) {
      const cap = Math.max(0, agreement.volumeCap);
      const supplier = supplierNode.get(agreement.supplierCorpId)!;
      const agreementId = agreementNode.get(index)!;
      const buyer = buyerNode.get(agreement.buyerCorpId)!;
      const deliveryEdge = addEdge(supplier, agreementId, cap);
      addEdge(agreementId, buyer, cap);
      deliveryEdgeByAgreement.set(index, deliveryEdge);
    }

    for (const buyer of buyers) {
      const demand = args.buyerDemandByCorpCommodity.get(buyer)?.get(commodity) ?? 0;
      addEdge(buyerNode.get(buyer)!, sink, Math.max(0, demand));
    }

    for (;;) {
      const parent = Array.from(
        { length: nextNode },
        () =>
          null as null | {
            node: number;
            edgeIndex: number;
          }
      );
      const queue = [source];
      parent[source] = { node: source, edgeIndex: -1 };
      for (let cursor = 0; cursor < queue.length && parent[sink] === null; cursor++) {
        const node = queue[cursor]!;
        for (let edgeIndex = 0; edgeIndex < graph[node]!.length; edgeIndex++) {
          const edge = graph[node]![edgeIndex]!;
          if (edge.capacity <= 1e-9 || parent[edge.to] !== null) continue;
          parent[edge.to] = { node, edgeIndex };
          queue.push(edge.to);
          if (edge.to === sink) break;
        }
      }
      if (parent[sink] === null) break;

      let amount = Number.POSITIVE_INFINITY;
      for (let node = sink; node !== source;) {
        const step = parent[node]!;
        amount = Math.min(amount, graph[step.node]![step.edgeIndex]!.capacity);
        node = step.node;
      }
      if (!(amount > 1e-9) || !Number.isFinite(amount)) break;
      for (let node = sink; node !== source;) {
        const step = parent[node]!;
        const edge = graph[step.node]![step.edgeIndex]!;
        edge.capacity -= amount;
        graph[node]![edge.reverseIndex]!.capacity += amount;
        node = step.node;
      }
    }

    for (const { index } of indexed) {
      const edge = deliveryEdgeByAgreement.get(index)!;
      deliveredByAgreement.set(index, Math.max(0, edge.originalCapacity - edge.capacity));
    }
  }

  rebalanceDeliveriesProRata({
    agreements: args.agreements,
    deliveredByAgreement,
    buyerDemandByCorpCommodity: args.buyerDemandByCorpCommodity,
  });

  return deliveredByAgreement;
}

/**
 * Build the supplier reservation book without reserving more private supply
 * than the named buyers can physically consume. When a buyer has overlapping
 * agreements, its demand is shared pro-rata by contract cap so clearing does
 * not arbitrarily privilege whichever agreement happened to be read first.
 */
export function computeDemandCappedContractReservations(args: {
  agreements: readonly SettleableSupplyAgreement[];
  buyerDemandByCorpCommodity: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
}): Map<string, Map<CommodityType, number>> {
  const weights = demandCappedAgreementWeights(args);
  const reservations = new Map<string, Map<CommodityType, number>>();
  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    const reserved = weights.get(index) ?? 0;
    if (!(reserved > 0)) continue;
    const byCommodity =
      reservations.get(agreement.supplierCorpId) ?? new Map<CommodityType, number>();
    byCommodity.set(agreement.commodity, (byCommodity.get(agreement.commodity) ?? 0) + reserved);
    reservations.set(agreement.supplierCorpId, byCommodity);
  }
  return reservations;
}

export interface SupplyAgreementDemandSector {
  corporationId: string;
  sectorType: CorporationType;
  revenueAnchor: number;
  strategyId?: string;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  productionPolicyLevel?: number | null;
  producedUnits?: number | null;
  capacityUnits?: number | null;
  mothballed?: boolean;
  isNatcorp?: boolean;
}

/**
 * Measure corporation input consumption on the same unit basis as the world
 * commodity ledger. This is the buyer-side physical ceiling for private
 * agreement delivery and prevents a contract from creating phantom inventory.
 */
export function computeSupplyAgreementBuyerDemand(args: {
  sectors: readonly SupplyAgreementDemandSector[];
  currentTurn: number;
  unitScale: number;
  plantsEnabled: boolean;
}): Map<string, Map<CommodityType, number>> {
  const result = new Map<string, Map<CommodityType, number>>();
  const unitScale = Number.isFinite(args.unitScale) && args.unitScale > 0 ? args.unitScale : 1;

  for (const sector of args.sectors) {
    if (args.plantsEnabled && sector.mothballed === true) continue;
    const rates = getEffectiveStrategyRates(
      sector.sectorType,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      args.currentTurn
    );
    const utilization =
      args.plantsEnabled &&
      typeof sector.producedUnits === "number" &&
      typeof sector.capacityUnits === "number" &&
      sector.capacityUnits > 0
        ? Math.max(0, Math.min(1, sector.producedUnits / sector.capacityUnits))
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
      const byCommodity = result.get(sector.corporationId) ?? new Map<CommodityType, number>();
      byCommodity.set(commodity, (byCommodity.get(commodity) ?? 0) + units);
      result.set(sector.corporationId, byCommodity);
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
  contractSettlementByCorp: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  /**
   * Optional physical demand ceiling for each buyer. When present, agreements
   * cannot deliver or price more units than the buyer actually consumes.
   */
  buyerDemandByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
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
  producedByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
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
    const key = `${a.supplierCorpId}:${a.commodity}`;
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
  const obligationBySupplierCommodity = new Map<string, Map<CommodityType, number>>();
  for (const agreement of agreements) {
    const byCommodity =
      obligationBySupplierCommodity.get(agreement.supplierCorpId) ??
      new Map<CommodityType, number>();
    byCommodity.set(
      agreement.commodity,
      (byCommodity.get(agreement.commodity) ?? 0) + Math.max(0, agreement.volumeCap)
    );
    obligationBySupplierCommodity.set(agreement.supplierCorpId, byCommodity);
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
      const key = `${agreement.supplierCorpId}:${agreement.commodity}`;
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
        producedByCorpCommodity.get(first.supplierCorpId)?.get(first.commodity) ?? 0
      );
      const achievableRaw = achievableByCorpCommodity
        ?.get(first.supplierCorpId)
        ?.get(first.commodity);
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
    const filled = contractSettlementByCorp.get(a.supplierCorpId)?.get(a.commodity) ?? 0;
    const totalCap = capByGroup.get(`${a.supplierCorpId}:${a.commodity}`) ?? 0;
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
                args.buyerDemandByCorpCommodity.get(a.buyerCorpId)?.get(a.commodity) ?? 0
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
  contractSettlementByCorp: Map<string, Map<CommodityType, number>>;
  /** Buyer demand ceiling used to assign delivered units to counterparties. */
  buyerDemandByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
  priceRatioByCommodity: ReadonlyMap<CommodityType, number>;
  /** Plants tier: supplier corpId -> commodity -> units actually produced. */
  producedByCorpCommodity?: ReadonlyMap<string, ReadonlyMap<CommodityType, number>>;
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
        updatedAt: now,
      };
      const unsetFields: Partial<
        Record<
          "lastAchievableUnits" | "lastCreditedProductionUnits" | "lastSupplierCashCurrency",
          ""
        >
      > = {
        ...(delivery.achievableUnits === undefined ? { lastAchievableUnits: "" } : {}),
        ...(delivery.creditedProductionUnits === undefined
          ? { lastCreditedProductionUnits: "" }
          : {}),
        ...(!delivery.supplierCurrencyCode ? { lastSupplierCashCurrency: "" } : {}),
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
    if (deliveryOps.length > 0) {
      await db.collection<SupplyAgreement>("supplyAgreements").bulkWrite(deliveryOps);
    }
  }
  if (txEntries.length > 0) await emitTxBulk(db, txEntries, args.thresholds);
  await notifySupplyAgreementDamages({ damages, lookups, turn });

  return { settledCount, totalPremiumAnchor, settledPremiums, deliveries, damages };
}

/**
 * Ticket #1147: tell a player-owned supplier's owner when its contract charged
 * shortfall damages. The penalty leg settles silently while the income
 * statement still shows a healthy per-turn profit — the reporting player's
 * cash sat flat for days with no signal anywhere that a signed volume cap was
 * eating the entire profit every turn. NPP/state corps (no real user) are
 * skipped; best-effort like every other notification in the turn pipeline.
 */
async function notifySupplyAgreementDamages(args: {
  damages: readonly SupplyAgreementDamages[];
  lookups: CorporationLookups;
  turn: number;
}): Promise<void> {
  if (args.damages.length === 0) return;
  const ZERO_USER = "000000000000000000000000";
  const notifications = args.damages.flatMap((d) => {
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
  }
}
