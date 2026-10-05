import { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { supplyAgreementScopeKey } from "@/lib/market/commodityMarketScope";
import type { FinancialTxLogEntry } from "@/lib/db/types/financialTxLog";
import { anchorToCorpCapital } from "@/lib/currency/corporationCapital";

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
  /**
   * Host state of a state-scoped agreement (freight). Every map this module
   * reads is keyed by {@link supplyAgreementScopeKey}, so a state contract is
   * reserved, delivered and settled against the supplier's and buyer's plants
   * in that one state, never the corporation's total.
   */
  stateId?: string;
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
  /**
   * Turn this agreement last notified its supplier's owner about damages.
   * Read by the damages-notice cooldown; see NOTICE_COOLDOWN_TURNS.
   */
  lastDamagesNoticeTurn?: number;
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

export type TxInput = Omit<FinancialTxLogEntry, "_id" | "expiresAt" | "flagged">;

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
  buyerCashDeltaLocal?: number;
  buyerCurrencyCode?: CurrencyCode;
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

export type AchievableByCorpCommodity = ReadonlyMap<string, ReadonlyMap<string, number | null>>;

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
export const MIN_SETTLE_ANCHOR = 1;

/** The key one agreement's volume is tracked under in every per-corp map here. */
export function scopeOf(a: Pick<SettleableSupplyAgreement, "commodity" | "stateId">): string {
  return supplyAgreementScopeKey(a.commodity, a.stateId);
}

export type ByCorpScope = ReadonlyMap<string, ReadonlyMap<string, number>>;

function demandCappedAgreementWeights(args: {
  agreements: readonly SettleableSupplyAgreement[];
  buyerDemandByCorpCommodity: ByCorpScope;
}): Map<number, number> {
  const totalCapByBuyerCommodity = new Map<string, number>();
  for (const agreement of args.agreements) {
    const key = `${agreement.buyerCorpId}:${scopeOf(agreement)}`;
    totalCapByBuyerCommodity.set(
      key,
      (totalCapByBuyerCommodity.get(key) ?? 0) + Math.max(0, agreement.volumeCap)
    );
  }

  const weights = new Map<number, number>();
  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    const cap = Math.max(0, agreement.volumeCap);
    const totalCap = totalCapByBuyerCommodity.get(`${agreement.buyerCorpId}:${scopeOf(agreement)}`);
    if (!(cap > 0) || !(totalCap && totalCap > 0)) continue;
    const demand = Math.max(
      0,
      args.buyerDemandByCorpCommodity.get(agreement.buyerCorpId)?.get(scopeOf(agreement)) ?? 0
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
  buyerDemandByCorpCommodity: ByCorpScope;
}): void {
  const weights = demandCappedAgreementWeights(args);
  const deliveredByBuyerCommodity = new Map<string, number>();
  const indicesBySupplierCommodity = new Map<string, number[]>();

  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    const delivered = args.deliveredByAgreement.get(index) ?? 0;
    const buyerKey = `${agreement.buyerCorpId}:${scopeOf(agreement)}`;
    deliveredByBuyerCommodity.set(
      buyerKey,
      (deliveredByBuyerCommodity.get(buyerKey) ?? 0) + delivered
    );
    const supplierKey = `${agreement.supplierCorpId}:${scopeOf(agreement)}`;
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
      const recipientBuyerKey = `${recipient.buyerCorpId}:${scopeOf(recipient)}`;
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
          args.buyerDemandByCorpCommodity.get(recipient.buyerCorpId)?.get(scopeOf(recipient)) ?? 0
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
          const donorBuyerKey = `${donor.buyerCorpId}:${scopeOf(donor)}`;
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
export function allocateDeliveriesToBuyers(args: {
  agreements: readonly SettleableSupplyAgreement[];
  contractSettlementByCorp: ByCorpScope;
  buyerDemandByCorpCommodity: ByCorpScope;
}): Map<number, number> {
  const deliveredByAgreement = new Map<number, number>();
  // One flow graph per scope: a state freight book is its own physical market.
  // Bucket the book once. The old shape re-scanned every agreement for every
  // scope — re-deriving `scopeOf` each time — which is O(scopes × agreements)
  // on a book that runs to thousands of rows. Each scope's graph is
  // independent, so bucket order cannot change the result.
  const byScope = new Map<string, { agreement: SettleableSupplyAgreement; index: number }[]>();
  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    if (!(agreement.volumeCap > 0)) continue;
    const scope = scopeOf(agreement);
    const bucket = byScope.get(scope);
    if (bucket) bucket.push({ agreement, index });
    else byScope.set(scope, [{ agreement, index }]);
  }

  for (const [scope, indexed] of byScope) {
    indexed.sort((left, right) =>
      (left.agreement.agreementId ?? String(left.index)).localeCompare(
        right.agreement.agreementId ?? String(right.index)
      )
    );

    const suppliers = [...new Set(indexed.map(({ agreement }) => agreement.supplierCorpId))];
    const buyers = [...new Set(indexed.map(({ agreement }) => agreement.buyerCorpId))];
    const source = 0;
    let nextNode = 1;
    const supplierNode = new Map(suppliers.map((id) => [id, nextNode++]));
    const agreementNode = new Map(indexed.map(({ index }) => [index, nextNode++]));
    const buyerNode = new Map(buyers.map((id) => [id, nextNode++]));
    const sink = nextNode++;
    // Adjacency is built per node in insertion order, then frozen into flat
    // typed arrays (CSR) for the search below. Edge `e` of node `n` lives at
    // `edgeStart[n] + e`, so every node still walks its edges in exactly the
    // order they were added, and capacities stay doubles (Float64Array), so
    // each subtraction and comparison is the one the object graph performed.
    const adjacency: number[][] = Array.from({ length: nextNode }, () => []);
    const edgeTo: number[] = [];
    const edgeCapacity: number[] = [];
    const edgeReverse: number[] = [];
    const addEdge = (from: number, to: number, capacity: number): number => {
      const forward = edgeTo.length;
      const reverse = forward + 1;
      edgeTo.push(to, from);
      edgeCapacity.push(capacity, 0);
      edgeReverse.push(reverse, forward);
      adjacency[from]!.push(forward);
      adjacency[to]!.push(reverse);
      return forward;
    };

    for (const supplier of suppliers) {
      const available = args.contractSettlementByCorp.get(supplier)?.get(scope) ?? 0;
      addEdge(source, supplierNode.get(supplier)!, Math.max(0, available));
    }

    const deliveryEdgeByAgreement = new Map<number, number>();
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
      const demand = args.buyerDemandByCorpCommodity.get(buyer)?.get(scope) ?? 0;
      addEdge(buyerNode.get(buyer)!, sink, Math.max(0, demand));
    }

    const edgeCount = edgeTo.length;
    const edgeStart = new Int32Array(nextNode + 1);
    const slotOfEdge = new Int32Array(edgeCount);
    for (let node = 0; node < nextNode; node++) {
      edgeStart[node + 1] = edgeStart[node]! + adjacency[node]!.length;
    }
    for (let node = 0; node < nextNode; node++) {
      const edges = adjacency[node]!;
      for (let position = 0; position < edges.length; position++) {
        slotOfEdge[edges[position]!] = edgeStart[node]! + position;
      }
    }
    const slotTo = new Int32Array(edgeCount);
    const slotCapacity = new Float64Array(edgeCount);
    const slotReverse = new Int32Array(edgeCount);
    for (let edge = 0; edge < edgeCount; edge++) {
      const slot = slotOfEdge[edge]!;
      slotTo[slot] = edgeTo[edge]!;
      slotCapacity[slot] = edgeCapacity[edge]!;
      slotReverse[slot] = slotOfEdge[edgeReverse[edge]!]!;
    }

    // Edmonds-Karp. The search order (edges in insertion order, stop at the
    // sink) decides WHICH maximum flow is found, so it is part of the result
    // and must not change. The flat arrays keep that order; they only drop
    // the per-edge object loads that dominated this step on a book of
    // thousands of agreements.
    const parentNode = new Int32Array(nextNode);
    const parentSlot = new Int32Array(nextNode);
    const queue = new Int32Array(nextNode);
    for (;;) {
      parentNode.fill(-1);
      parentNode[source] = source;
      parentSlot[source] = -1;
      let head = 0;
      let tail = 0;
      queue[tail++] = source;
      while (head < tail && parentNode[sink] === -1) {
        const node = queue[head++]!;
        const end = edgeStart[node + 1]!;
        for (let slot = edgeStart[node]!; slot < end; slot++) {
          const to = slotTo[slot]!;
          if (slotCapacity[slot]! <= 1e-9 || parentNode[to] !== -1) continue;
          parentNode[to] = node;
          parentSlot[to] = slot;
          queue[tail++] = to;
          if (to === sink) break;
        }
      }
      if (parentNode[sink] === -1) break;

      let amount = Number.POSITIVE_INFINITY;
      for (let node = sink; node !== source; node = parentNode[node]!) {
        amount = Math.min(amount, slotCapacity[parentSlot[node]!]!);
      }
      if (!(amount > 1e-9) || !Number.isFinite(amount)) break;
      for (let node = sink; node !== source; node = parentNode[node]!) {
        const slot = parentSlot[node]!;
        slotCapacity[slot] = slotCapacity[slot]! - amount;
        slotCapacity[slotReverse[slot]!] = slotCapacity[slotReverse[slot]!]! + amount;
      }
    }

    for (const { index } of indexed) {
      const edge = deliveryEdgeByAgreement.get(index)!;
      deliveredByAgreement.set(
        index,
        Math.max(0, edgeCapacity[edge]! - slotCapacity[slotOfEdge[edge]!]!)
      );
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
  buyerDemandByCorpCommodity: ByCorpScope;
}): Map<string, Map<string, number>> {
  const weights = demandCappedAgreementWeights(args);
  const reservations = new Map<string, Map<string, number>>();
  for (let index = 0; index < args.agreements.length; index++) {
    const agreement = args.agreements[index]!;
    const reserved = weights.get(index) ?? 0;
    if (!(reserved > 0)) continue;
    const key = scopeOf(agreement);
    const byKey = reservations.get(agreement.supplierCorpId) ?? new Map<string, number>();
    byKey.set(key, (byKey.get(key) ?? 0) + reserved);
    reservations.set(agreement.supplierCorpId, byKey);
  }
  return reservations;
}

export interface SupplyAgreementDemandSector {
  corporationId: string;
  sectorType: CorporationType;
  industryModel?: string | null;
  mediaDiscriminator?: string | null;
  revenueAnchor: number;
  strategyId?: string;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  productionPolicyLevel?: number | null;
  producedUnits?: number | null;
  capacityUnits?: number | null;
  mothballed?: boolean;
  isNatcorp?: boolean;
  /** Host state, so state-scoped demand (freight) can be booked per state. */
  stateId?: string;
}
