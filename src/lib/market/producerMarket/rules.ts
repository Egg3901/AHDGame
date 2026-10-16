import { ProducerSupplyPool } from "./supplyPoolRules";
/**
 * Every producer sells delivered units at its posted price. Manual, cost-plus
 * and automatic quotes share the same funded order book and trade receipts.
 */

export interface MarketAccount {
  id: string;
  /** Spendable operating cash only. Bank reserves, deposits and loan principal are excluded. */
  cash: number;
}

export interface ProducerOffer {
  id: string;
  accountId: string;
  commodity: string;
  book: string;
  units: number;
  unitPrice: number;
  /** A binding delivery ceiling, independent of the asking price. */
  deliverableUnits?: number;
}

export interface PurchaseOrder {
  id: string;
  accountId: string;
  commodity: string;
  book: string;
  units: number;
  maximumUnitPrice: number;
  /** Reserved cash budget for this order, shared with the account's other orders. */
  maximumSpend?: number;
  /** Named supplier reservations compete for the same stock and budget as public purchases. */
  supplierOfferId?: string;
  /** A validated supplier contract fixes the price while sharing the public offer's stock. */
  contractUnitPrice?: number;
  /** Optional eligible suppliers implement embargoes, routes and local-service scope. */
  eligibleOfferIds?: readonly string[];
  /** Reserved orders precede public orders. Equal priority is deterministic by id. */
  priority?: number;
  /** Reservations and their public fallback share one physical purchase target. */
  quantityGroup?: { id: string; maximumUnits: number };
}

export interface ProducerTrade {
  id: string;
  kind: "sale" | "internalTransfer";
  offerId: string;
  orderId: string;
  sellerAccountId: string;
  buyerAccountId: string;
  commodity: string;
  book: string;
  units: number;
  unitPrice: number;
  amount: number;
}

/** A compact replay of exact pro-rata fills, with every supplier constraint retained. */
export interface ProducerTradeReceipt {
  turn: number;
  offers: readonly ProducerOffer[];
  orders: readonly PurchaseOrder[];
  fills: Array<{
    orderId: string;
    kind: "sale" | "internalTransfer";
    unitPrice: number;
    units: number;
  }>;
  tradeCount: number;
}

/** Expand supplier-level trades for audits or route and contract accounting without retaining a matrix. */
export function* producerTrades(receipt: ProducerTradeReceipt): Generator<ProducerTrade> {
  const orders = new Map(receipt.orders.map((order) => [order.id, order]));
  const poolByOffer = new Map<string, ProducerSupplyPool>();
  const pools = new Map<string, ProducerSupplyPool>();
  for (const offer of receipt.offers) {
    const key = JSON.stringify([offer.commodity, offer.book, offer.unitPrice]);
    const pool = pools.get(key) ?? new ProducerSupplyPool();
    pool.add(offer.id, Math.min(offer.units, offer.deliverableUnits ?? offer.units));
    pools.set(key, pool);
    poolByOffer.set(offer.id, pool);
  }
  const remaining = {
    get: (id: string) => poolByOffer.get(id)!.remaining(id),
    set: (id: string, units: number) => poolByOffer.get(id)!.setRemaining(id, units),
  };
  const books = new Map<string, ProducerOffer[]>();
  for (const offer of receipt.offers) {
    const key = bookKey(offer.commodity, offer.book);
    const rows = books.get(key) ?? [];
    rows.push(offer);
    books.set(key, rows);
  }
  for (const rows of books.values())
    rows.sort((a, b) => a.unitPrice - b.unitPrice || compareId(a.id, b.id));
  let tradeCount = 0;
  for (const fill of receipt.fills) {
    const order = orders.get(fill.orderId);
    if (!order) throw new Error("Missing producer trade order");
    const eligible = order.eligibleOfferIds ? new Set(order.eligibleOfferIds) : null;
    const internal = fill.kind === "internalTransfer";
    const group = (books.get(bookKey(order.commodity, order.book)) ?? []).filter(
      (offer) =>
        (offer.accountId === order.accountId) === internal &&
        (internal || (order.contractUnitPrice ?? offer.unitPrice) === fill.unitPrice) &&
        (!order.supplierOfferId || offer.id === order.supplierOfferId) &&
        (!eligible || eligible.has(offer.id))
    );
    const pooled =
      !internal &&
      !order.eligibleOfferIds &&
      !order.supplierOfferId &&
      order.contractUnitPrice == null
        ? poolByOffer.get(group[0]?.id)
        : undefined;
    const total = pooled?.total ?? group.reduce((sum, offer) => sum + remaining.get(offer.id)!, 0);
    if (!(total > 0) || fill.units > total + Math.max(1e-8, total * 1e-12))
      throw new Error("Invalid producer trade fill");
    for (const offer of group) {
      const available = remaining.get(offer.id)!;
      const units = Math.min(available, (fill.units / total) * available);
      if (!(units > 0)) continue;
      if (!pooled) remaining.set(offer.id, Math.max(0, available - units));
      tradeCount++;
      yield {
        id: JSON.stringify([receipt.turn, order.id, offer.id]),
        kind: fill.kind,
        offerId: offer.id,
        orderId: order.id,
        sellerAccountId: offer.accountId,
        buyerAccountId: order.accountId,
        commodity: order.commodity,
        book: order.book,
        units,
        unitPrice: fill.unitPrice,
        amount: units * fill.unitPrice,
      };
    }
    if (pooled) pooled.take(fill.units);
  }
  if (tradeCount !== receipt.tradeCount) throw new Error("Producer trade count mismatch");
}

export interface ProducerMarketResult {
  accounts: MarketAccount[];
  tradeReceipt: ProducerTradeReceipt;
  offers: Array<{
    id: string;
    offeredUnits: number;
    soldUnits: number;
    internalDeliveredUnits: number;
    deliveredUnits: number;
    revenue: number;
  }>;
  orders: Array<{ id: string; requestedUnits: number; deliveredUnits: number; cost: number }>;
  prices: Array<{
    commodity: string;
    book: string;
    units: number;
    value: number;
    unitPrice: number;
  }>;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

function unique<T extends { id: string }>(rows: readonly T[], label: string): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error(`Duplicate or empty ${label} id`);
    ids.add(row.id);
  }
}

const compareId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const bookKey = (commodity: string, book: string) => JSON.stringify([commodity, book]);

/** One pure clearing pass. Seller receipts, buyer charges and observed prices share the same trades. */
export function settleProducerMarket(input: {
  turn: number;
  accounts: readonly MarketAccount[];
  offers: readonly ProducerOffer[];
  orders: readonly PurchaseOrder[];
}): ProducerMarketResult {
  if (!Number.isSafeInteger(input.turn) || input.turn < 0) throw new Error("Invalid market turn");
  unique(input.accounts, "account");
  unique(input.offers, "offer");
  unique(input.orders, "order");
  const cash = new Map(input.accounts.map((a) => [a.id, nonNegative(a.cash, "operating cash")]));
  // Opening budgets prevent a circular chain of unfunded sales from financing itself.
  const budgets = new Map(cash);
  const poolByOffer = new Map<string, ProducerSupplyPool>();
  const poolsByBook = new Map<string, Map<number, ProducerSupplyPool>>();
  const ownByBook = new Map<string, Map<string, ProducerOffer[]>>();
  const remaining = {
    get: (id: string) => poolByOffer.get(id)!.remaining(id),
    set: (id: string, units: number) => poolByOffer.get(id)!.setRemaining(id, units),
  };
  const offered = new Map<string, number>();
  const byBook = new Map<string, ProducerOffer[]>();
  for (const offer of input.offers) {
    if (!cash.has(offer.accountId)) throw new Error("Unknown seller account");
    nonNegative(offer.unitPrice, "offer price");
    const units = nonNegative(offer.units, "offer units");
    const available = Math.min(
      units,
      offer.deliverableUnits == null
        ? units
        : nonNegative(offer.deliverableUnits, "delivery ceiling")
    );
    offered.set(offer.id, available);
    const key = bookKey(offer.commodity, offer.book);
    const levels = poolsByBook.get(key) ?? new Map<number, ProducerSupplyPool>();
    const pool = levels.get(offer.unitPrice) ?? new ProducerSupplyPool();
    pool.add(offer.id, available);
    levels.set(offer.unitPrice, pool);
    poolsByBook.set(key, levels);
    poolByOffer.set(offer.id, pool);
    const owners = ownByBook.get(key) ?? new Map<string, ProducerOffer[]>();
    const owned = owners.get(offer.accountId) ?? [];
    owned.push(offer);
    owners.set(offer.accountId, owned);
    ownByBook.set(key, owners);
    const rows = byBook.get(key) ?? [];
    rows.push(offer);
    byBook.set(key, rows);
  }
  for (const rows of byBook.values())
    rows.sort((a, b) => a.unitPrice - b.unitPrice || compareId(a.id, b.id));
  for (const owners of ownByBook.values())
    for (const rows of owners.values())
      rows.sort((a, b) => a.unitPrice - b.unitPrice || compareId(a.id, b.id));
  const sortedPoolsByBook = new Map(
    [...poolsByBook].map(([key, pools]) => [key, [...pools].sort(([a], [b]) => a - b)])
  );
  const quantityGroups = new Map<
    string,
    { accountId: string; commodity: string; book: string; maximumUnits: number; remaining: number }
  >();
  for (const order of input.orders) {
    if (!cash.has(order.accountId)) throw new Error("Unknown buyer account");
    nonNegative(order.units, "order units");
    nonNegative(order.maximumUnitPrice, "limit price");
    if (order.contractUnitPrice != null) {
      nonNegative(order.contractUnitPrice, "contract price");
      if (!order.supplierOfferId || order.contractUnitPrice > order.maximumUnitPrice)
        throw new Error("Contract price requires a named supplier within the buyer limit");
    }
    if (order.quantityGroup) {
      const { id, maximumUnits } = order.quantityGroup;
      nonNegative(maximumUnits, "group quantity");
      if (!id) throw new Error("Missing purchase group identity");
      const prior = quantityGroups.get(id);
      if (
        prior &&
        (prior.accountId !== order.accountId ||
          prior.commodity !== order.commodity ||
          prior.book !== order.book ||
          prior.maximumUnits !== maximumUnits)
      )
        throw new Error("Inconsistent purchase group");
      if (!prior)
        quantityGroups.set(id, {
          accountId: order.accountId,
          commodity: order.commodity,
          book: order.book,
          maximumUnits,
          remaining: maximumUnits,
        });
    }
    if (order.maximumSpend != null) nonNegative(order.maximumSpend, "order spending limit");
    if (order.priority != null && !Number.isFinite(order.priority))
      throw new Error("Invalid priority");
  }
  const orderResults = new Map(
    input.orders.map((o) => [
      o.id,
      { id: o.id, requestedUnits: o.units, deliveredUnits: 0, cost: 0 },
    ])
  );
  const offerResults = new Map(
    input.offers.map((o) => [
      o.id,
      {
        id: o.id,
        offeredUnits: offered.get(o.id)!,
        soldUnits: 0,
        internalDeliveredUnits: 0,
        deliveredUnits: 0,
        revenue: 0,
      },
    ])
  );
  const fills: ProducerTradeReceipt["fills"] = [];
  let tradeCount = 0;
  const prices = new Map<string, ProducerMarketResult["prices"][number]>();
  const orders = [...input.orders].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      Number(!!b.supplierOfferId) - Number(!!a.supplierOfferId) ||
      compareId(a.id, b.id)
  );
  for (const order of orders) {
    const quantityGroup = order.quantityGroup && quantityGroups.get(order.quantityGroup.id);
    let wanted = Math.min(order.units, quantityGroup?.remaining ?? order.units);
    let orderBudget = order.maximumSpend ?? Number.MAX_VALUE;
    const eligible = order.eligibleOfferIds ? new Set(order.eligibleOfferIds) : null;
    const key = bookKey(order.commodity, order.book);
    if (!eligible && !order.supplierOfferId && order.contractUnitPrice == null) {
      const own = ownByBook.get(key)?.get(order.accountId) ?? [];
      const ownTotal = own.reduce((sum, offer) => sum + remaining.get(offer.id), 0);
      const ownTake = Math.min(wanted, ownTotal);
      if (ownTake > 0) {
        fills.push({ orderId: order.id, kind: "internalTransfer", unitPrice: 0, units: ownTake });
        const fraction = ownTake / ownTotal;
        for (const offer of own) {
          const available = remaining.get(offer.id);
          const units = Math.min(available, fraction * available);
          if (!(units > 0)) continue;
          remaining.set(offer.id, Math.max(0, available - units));
          const seller = offerResults.get(offer.id)!;
          seller.internalDeliveredUnits += units;
          seller.deliveredUnits += units;
          tradeCount++;
        }
        orderResults.get(order.id)!.deliveredUnits += ownTake;
        wanted = Math.max(0, wanted - ownTake);
        if (quantityGroup) quantityGroup.remaining = Math.max(0, quantityGroup.remaining - ownTake);
      }
      for (const [price, pool] of sortedPoolsByBook.get(key) ?? []) {
        if (!(wanted > 0) || price > order.maximumUnitPrice) break;
        const budget = Math.min(budgets.get(order.accountId)!, orderBudget);
        const take = Math.min(wanted, pool.total, price > 0 ? budget / price : wanted);
        if (!(take > 0)) continue;
        const amount = take * price;
        if (!Number.isFinite(amount)) throw new Error("Non-finite trade value");
        tradeCount += pool.activeCount;
        pool.take(take);
        fills.push({ orderId: order.id, kind: "sale", unitPrice: price, units: take });
        wanted = Math.max(0, wanted - take);
        if (quantityGroup) quantityGroup.remaining = Math.max(0, quantityGroup.remaining - take);
        orderBudget = Math.max(0, orderBudget - amount);
        budgets.set(order.accountId, Math.max(0, budgets.get(order.accountId)! - amount));
        cash.set(order.accountId, Math.max(0, cash.get(order.accountId)! - amount));
        const buyer = orderResults.get(order.id)!;
        buyer.deliveredUnits += take;
        buyer.cost += amount;
        const observed = prices.get(key) ?? {
          commodity: order.commodity,
          book: order.book,
          units: 0,
          value: 0,
          unitPrice: 0,
        };
        observed.units += take;
        observed.value += amount;
        observed.unitPrice = observed.value / observed.units;
        prices.set(key, observed);
      }
      continue;
    }
    const rows = (byBook.get(key) ?? []).filter(
      (offer) =>
        (offer.accountId === order.accountId ||
          (order.contractUnitPrice ?? offer.unitPrice) <= order.maximumUnitPrice) &&
        (!order.supplierOfferId || order.supplierOfferId === offer.id) &&
        (!eligible || eligible.has(offer.id))
    );
    const tiers = new Map<number, ProducerOffer[]>();
    for (const offer of rows) {
      const price =
        offer.accountId === order.accountId ? 0 : (order.contractUnitPrice ?? offer.unitPrice);
      const tier = tiers.get(price) ?? [];
      tier.push(offer);
      tiers.set(price, tier);
    }
    for (const [, tier] of [...tiers].sort(([a], [b]) => a - b)) {
      // At an identical price, using owned stock needs no outside financing.
      // Outside suppliers at that price split the remaining purchase pro rata.
      for (const internal of [true, false]) {
        const group = tier.filter((o) => (o.accountId === order.accountId) === internal);
        const total = group.reduce((n, o) => n + remaining.get(o.id)!, 0);
        const price = order.contractUnitPrice ?? group[0]?.unitPrice ?? 0;
        const budget = Math.min(budgets.get(order.accountId)!, orderBudget);
        const take = Math.min(wanted, total, internal || price === 0 ? wanted : budget / price);
        if (!(take > 0) || !(total > 0)) continue;
        fills.push({
          orderId: order.id,
          kind: internal ? "internalTransfer" : "sale",
          unitPrice: internal ? 0 : price,
          units: take,
        });
        for (const offer of group) {
          const available = remaining.get(offer.id)!;
          const units = Math.min(available, (take / total) * available);
          if (!(units > 0)) continue;
          // Moving owned goods between sites is a physical transfer. It cannot
          // create a sale, an acquisition asset or profit for the corporation.
          const unitPrice = internal ? 0 : price;
          const amount = units * unitPrice;
          if (!Number.isFinite(amount)) throw new Error("Non-finite trade value");
          tradeCount++;
          if (!internal) {
            const key = bookKey(order.commodity, order.book);
            const observed = prices.get(key) ?? {
              commodity: order.commodity,
              book: order.book,
              units: 0,
              value: 0,
              unitPrice: 0,
            };
            observed.units += units;
            observed.value += amount;
            observed.unitPrice = observed.value / observed.units;
            prices.set(key, observed);
          }
          wanted = Math.max(0, wanted - units);
          if (quantityGroup) quantityGroup.remaining = Math.max(0, quantityGroup.remaining - units);
          remaining.set(offer.id, Math.max(0, available - units));
          if (!internal) {
            orderBudget = Math.max(0, orderBudget - amount);
            budgets.set(order.accountId, Math.max(0, budgets.get(order.accountId)! - amount));
            cash.set(order.accountId, Math.max(0, cash.get(order.accountId)! - amount));
            cash.set(
              offer.accountId,
              nonNegative(cash.get(offer.accountId)! + amount, "closing seller cash")
            );
          }
          const buyer = orderResults.get(order.id)!;
          buyer.deliveredUnits += units;
          buyer.cost += amount;
          const seller = offerResults.get(offer.id)!;
          if (internal) seller.internalDeliveredUnits += units;
          else seller.soldUnits += units;
          seller.deliveredUnits += units;
          seller.revenue += amount;
        }
      }
      if (!(wanted > 0)) break;
    }
  }
  for (const offer of input.offers) {
    if (!poolByOffer.get(offer.id)!.hasPooledSales) continue;
    const seller = offerResults.get(offer.id)!;
    const units = poolByOffer.get(offer.id)!.pooledSold(offer.id);
    const amount = units * offer.unitPrice;
    seller.soldUnits += units;
    seller.deliveredUnits += units;
    seller.revenue += amount;
    cash.set(
      offer.accountId,
      nonNegative(cash.get(offer.accountId)! + amount, "closing seller cash")
    );
  }
  return {
    accounts: [...cash]
      .sort(([a], [b]) => compareId(a, b))
      .map(([id, value]) => ({ id, cash: value })),
    tradeReceipt: {
      turn: input.turn,
      offers: input.offers,
      orders: input.orders,
      fills,
      tradeCount,
    },
    offers: [...offerResults.values()].sort((a, b) => compareId(a.id, b.id)),
    orders: [...orderResults.values()].sort((a, b) => compareId(a.id, b.id)),
    prices: [...prices.values()].sort((a, b) =>
      compareId(bookKey(a.commodity, a.book), bookKey(b.commodity, b.book))
    ),
  };
}

export type ProducerQuotePolicy =
  | { kind: "manual"; unitPrice: number }
  | { kind: "costPlus"; markup: number }
  | { kind: "automatic"; targetMarkup: number };

/** Price levels let every candidate use cumulative volumes instead of rescanning the book. */
function priceVolumes(rows: readonly { price: number; units: number }[]) {
  const levels = new Map<number, number>();
  for (const row of rows) {
    const price = nonNegative(row.price, "price level");
    levels.set(
      price,
      nonNegative((levels.get(price) ?? 0) + nonNegative(row.units, "level units"), "level volume")
    );
  }
  const prices = [...levels.keys()].sort((a, b) => a - b);
  const before = Array<number>(prices.length + 1).fill(0);
  const after = Array<number>(prices.length + 1).fill(0);
  for (let i = 0; i < prices.length; i++)
    before[i + 1] = nonNegative(before[i] + levels.get(prices[i])!, "cumulative volume");
  for (let i = prices.length - 1; i >= 0; i--)
    after[i] = nonNegative(after[i + 1] + levels.get(prices[i])!, "cumulative volume");
  return {
    prices,
    at: (price: number) => {
      let low = 0,
        high = prices.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (prices[mid] < price) low = mid + 1;
        else high = mid;
      }
      return { cheaper: before[low], tied: levels.get(price) ?? 0, atOrAbove: after[low] };
    },
  };
}

/** Quote policy selects an asking price only; all policies settle identically. */
export function quoteProducer(input: {
  policy: ProducerQuotePolicy;
  referenceUnitPrice: number;
  variableUnitCost: number;
  fixedCost: number;
  offeredUnits: number;
  demand: readonly { maximumUnitPrice: number; units: number }[];
  competitors: readonly { unitPrice: number; units: number }[];
}): {
  unitPrice: number;
  breakEvenUnitPrice: number | null;
  expectedSoldUnits: number;
  expectedProfit: number;
} {
  const reference = nonNegative(input.referenceUnitPrice, "reference price");
  const variable = nonNegative(input.variableUnitCost, "variable unit cost");
  const fixed = nonNegative(input.fixedCost, "fixed cost");
  const units = nonNegative(input.offeredUnits, "offered units");
  const breakEven = units > 0 ? variable + fixed / units : null;
  const demandVolumes = priceVolumes(
    input.demand.map((o) => ({ price: o.maximumUnitPrice, units: o.units }))
  );
  const supplyVolumes = priceVolumes(
    input.competitors.map((o) => ({ price: o.unitPrice, units: o.units }))
  );
  const estimate = (price: number) => {
    const demand = demandVolumes.at(price).atOrAbove;
    const supply = supplyVolumes.at(price);
    const cheaper = supply.cheaper;
    const tied = units + supply.tied;
    const sold = tied > 0 ? Math.min(units, (Math.max(0, demand - cheaper) * units) / tied) : 0;
    return {
      unitPrice: price,
      breakEvenUnitPrice: breakEven,
      expectedSoldUnits: sold,
      expectedProfit: sold * price - variable * units - fixed,
    };
  };
  if (input.policy.kind === "manual")
    return estimate(nonNegative(input.policy.unitPrice, "manual price"));
  const markup = input.policy.kind === "costPlus" ? input.policy.markup : input.policy.targetMarkup;
  if (!Number.isFinite(markup) || markup < -1) throw new Error("Invalid target markup");
  const target = (breakEven ?? reference) * (1 + markup);
  if (input.policy.kind === "costPlus") return estimate(target);
  const candidates = new Set([reference, target]);
  for (const seller of input.competitors)
    candidates.add(nonNegative(seller.unitPrice, "competitor price"));
  for (const order of input.demand)
    candidates.add(nonNegative(order.maximumUnitPrice, "demand limit"));
  return [...candidates]
    .map(estimate)
    .sort((a, b) => b.expectedProfit - a.expectedProfit || a.unitPrice - b.unitPrice)[0];
}
