/**
 * Equivalence guard for the flat-array max-flow in allocateDeliveriesToBuyers.
 *
 * The reference below is the previous object-graph implementation, copied
 * verbatim (only renamed and given local helpers). Both run over randomized
 * books, including state-scoped freight, shared supplier/buyer pairs, zero and
 * fractional capacities, and must return bit-identical per-agreement deliveries.
 */

import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  allocateDeliveriesToBuyers,
  type SettleableSupplyAgreement,
} from "./settleSupplyAgreements";
import { supplyAgreementScopeKey } from "@/lib/market/commodityMarketScope";
import type { CommodityType } from "@/lib/constants/commodities";

function scopeOf(a: Pick<SettleableSupplyAgreement, "commodity" | "stateId">): string {
  return supplyAgreementScopeKey(a.commodity, a.stateId);
}

type ByCorpScope = ReadonlyMap<string, ReadonlyMap<string, number>>;

type DeliveryFlowEdge = {
  to: number;
  reverseIndex: number;
  capacity: number;
  originalCapacity: number;
};

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
function referenceAllocateDeliveriesToBuyers(args: {
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
      const available = args.contractSettlementByCorp.get(supplier)?.get(scope) ?? 0;
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
      const demand = args.buyerDemandByCorpCommodity.get(buyer)?.get(scope) ?? 0;
      addEdge(buyerNode.get(buyer)!, sink, Math.max(0, demand));
    }

    // Edmonds-Karp. The search order (edges in insertion order, stop at the
    // sink) decides WHICH maximum flow is found, so it is part of the result
    // and must not change. Reusing typed arrays across searches keeps that
    // order while dropping a fresh node-sized array of objects per augmenting
    // path, which dominated this step on a book of thousands of agreements.
    const parentNode = new Int32Array(nextNode);
    const parentEdge = new Int32Array(nextNode);
    const queue = new Int32Array(nextNode);
    for (;;) {
      parentNode.fill(-1);
      parentNode[source] = source;
      parentEdge[source] = -1;
      let head = 0;
      let tail = 0;
      queue[tail++] = source;
      while (head < tail && parentNode[sink] === -1) {
        const node = queue[head++]!;
        const edges = graph[node]!;
        for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
          const edge = edges[edgeIndex]!;
          if (edge.capacity <= 1e-9 || parentNode[edge.to] !== -1) continue;
          parentNode[edge.to] = node;
          parentEdge[edge.to] = edgeIndex;
          queue[tail++] = edge.to;
          if (edge.to === sink) break;
        }
      }
      if (parentNode[sink] === -1) break;

      let amount = Number.POSITIVE_INFINITY;
      for (let node = sink; node !== source;) {
        const from = parentNode[node]!;
        amount = Math.min(amount, graph[from]![parentEdge[node]!]!.capacity);
        node = from;
      }
      if (!(amount > 1e-9) || !Number.isFinite(amount)) break;
      for (let node = sink; node !== source;) {
        const from = parentNode[node]!;
        const edge = graph[from]![parentEdge[node]!]!;
        edge.capacity -= amount;
        graph[node]![edge.reverseIndex]!.capacity += amount;
        node = from;
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

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

type Book = {
  agreements: SettleableSupplyAgreement[];
  supply: Map<string, Map<string, number>>;
  demand: Map<string, Map<string, number>>;
};

function randomBook(seed: number): Book {
  const random = rng(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const commodities: CommodityType[] = ["steel", "food", "electronics", "freight"];
  const states = ["state-a", "state-b", "state-c"];
  const corps = Array.from({ length: 4 + Math.floor(random() * 40) }, () =>
    new ObjectId().toString()
  );
  const agreements: SettleableSupplyAgreement[] = [];
  const count = 1 + Math.floor(random() * 300);
  for (let index = 0; index < count; index++) {
    const commodity = pick(commodities);
    const capRoll = random();
    agreements.push({
      // A few rows without ids exercise the index-keyed sort fallback.
      ...(random() < 0.05 ? {} : { agreementId: new ObjectId().toString() }),
      supplierCorpId: pick(corps),
      buyerCorpId: pick(corps),
      commodity,
      ...(commodity === "freight" && random() < 0.7 ? { stateId: pick(states) } : {}),
      volumeCap: capRoll < 0.1 ? 0 : capRoll < 0.5 ? Math.round(random() * 400) : random() * 400,
      pricePremium: 0,
    });
  }
  const supply = new Map<string, Map<string, number>>();
  const demand = new Map<string, Map<string, number>>();
  const keyFor = (a: SettleableSupplyAgreement) => supplyAgreementScopeKey(a.commodity, a.stateId);
  for (const a of agreements) {
    if (random() < 0.9) {
      const bySupplier = supply.get(a.supplierCorpId) ?? new Map<string, number>();
      bySupplier.set(keyFor(a), random() < 0.2 ? 0 : random() * 1500);
      supply.set(a.supplierCorpId, bySupplier);
    }
    if (random() < 0.9) {
      const byBuyer = demand.get(a.buyerCorpId) ?? new Map<string, number>();
      byBuyer.set(keyFor(a), random() < 0.1 ? 1e-10 : random() * 1500);
      demand.set(a.buyerCorpId, byBuyer);
    }
  }
  return { agreements, supply, demand };
}

describe("allocateDeliveriesToBuyers flat-array max-flow", () => {
  it("matches the object-graph reference bit for bit on randomized books", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const { agreements, supply, demand } = randomBook(seed);
      const expected = referenceAllocateDeliveriesToBuyers({
        agreements,
        contractSettlementByCorp: supply,
        buyerDemandByCorpCommodity: demand,
      });
      const actual = allocateDeliveriesToBuyers({
        agreements,
        contractSettlementByCorp: supply,
        buyerDemandByCorpCommodity: demand,
      });
      // Same keys in the same insertion order, and Object.is on every value.
      expect([...actual.keys()]).toEqual([...expected.keys()]);
      for (const [index, units] of expected) {
        expect(Object.is(actual.get(index), units)).toBe(true);
      }
    }
  });
});
