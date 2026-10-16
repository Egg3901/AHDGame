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
  /** Named supplier reservations compete for the same stock and budget as public purchases. */
  supplierOfferId?: string;
  /** Optional eligible suppliers implement embargoes, routes and local-service scope. */
  eligibleOfferIds?: readonly string[];
  /** Reserved orders precede public orders. Equal priority is deterministic by id. */
  priority?: number;
}

export interface ProducerTrade {
  id: string;
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

export interface ProducerMarketResult {
  accounts: MarketAccount[];
  trades: ProducerTrade[];
  offers: Array<{ id: string; offeredUnits: number; deliveredUnits: number; revenue: number }>;
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
  const remaining = new Map<string, number>();
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
    remaining.set(offer.id, available);
    const key = bookKey(offer.commodity, offer.book);
    const rows = byBook.get(key) ?? [];
    rows.push(offer);
    byBook.set(key, rows);
  }
  for (const rows of byBook.values())
    rows.sort((a, b) => a.unitPrice - b.unitPrice || compareId(a.id, b.id));
  for (const order of input.orders) {
    if (!cash.has(order.accountId)) throw new Error("Unknown buyer account");
    nonNegative(order.units, "order units");
    nonNegative(order.maximumUnitPrice, "limit price");
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
      { id: o.id, offeredUnits: offered.get(o.id)!, deliveredUnits: 0, revenue: 0 },
    ])
  );
  const trades: ProducerTrade[] = [];
  const orders = [...input.orders].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      Number(!!b.supplierOfferId) - Number(!!a.supplierOfferId) ||
      compareId(a.id, b.id)
  );
  for (const order of orders) {
    let wanted = order.units;
    const eligible = order.eligibleOfferIds ? new Set(order.eligibleOfferIds) : null;
    const rows = (byBook.get(bookKey(order.commodity, order.book)) ?? []).filter(
      (offer) =>
        offer.unitPrice <= order.maximumUnitPrice &&
        (!order.supplierOfferId || order.supplierOfferId === offer.id) &&
        (!eligible || eligible.has(offer.id))
    );
    const tiers = new Map<number, ProducerOffer[]>();
    for (const offer of rows) {
      const tier = tiers.get(offer.unitPrice) ?? [];
      tier.push(offer);
      tiers.set(offer.unitPrice, tier);
    }
    for (const tier of tiers.values()) {
      // At an identical price, using owned stock needs no outside financing.
      // Outside suppliers at that price split the remaining purchase pro rata.
      for (const internal of [true, false]) {
        const group = tier.filter((o) => (o.accountId === order.accountId) === internal);
        const total = group.reduce((n, o) => n + remaining.get(o.id)!, 0);
        const price = group[0]?.unitPrice ?? 0;
        const budget = budgets.get(order.accountId)!;
        const take = Math.min(wanted, total, internal || price === 0 ? wanted : budget / price);
        if (!(take > 0) || !(total > 0)) continue;
        for (const offer of group) {
          const available = remaining.get(offer.id)!;
          const units = Math.min(available, (take * available) / total);
          if (!(units > 0)) continue;
          const amount = units * offer.unitPrice;
          if (!Number.isFinite(amount)) throw new Error("Non-finite trade value");
          const trade: ProducerTrade = {
            id: JSON.stringify([input.turn, order.id, offer.id]),
            offerId: offer.id,
            orderId: order.id,
            sellerAccountId: offer.accountId,
            buyerAccountId: order.accountId,
            commodity: order.commodity,
            book: order.book,
            units,
            unitPrice: offer.unitPrice,
            amount,
          };
          trades.push(trade);
          wanted = Math.max(0, wanted - units);
          remaining.set(offer.id, Math.max(0, available - units));
          if (!internal) {
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
          seller.deliveredUnits += units;
          seller.revenue += amount;
        }
      }
      if (!(wanted > 0)) break;
    }
  }
  const prices = new Map<string, ProducerMarketResult["prices"][number]>();
  for (const trade of trades) {
    // Transfers within one cash account are not independent market-price observations.
    if (trade.buyerAccountId === trade.sellerAccountId) continue;
    const key = bookKey(trade.commodity, trade.book);
    const price = prices.get(key) ?? {
      commodity: trade.commodity,
      book: trade.book,
      units: 0,
      value: 0,
      unitPrice: 0,
    };
    price.units += trade.units;
    price.value += trade.amount;
    price.unitPrice = price.value / price.units;
    prices.set(key, price);
  }
  return {
    accounts: [...cash]
      .sort(([a], [b]) => compareId(a, b))
      .map(([id, value]) => ({ id, cash: value })),
    trades,
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
  const estimate = (price: number) => {
    let demand = 0;
    for (const order of input.demand) {
      nonNegative(order.maximumUnitPrice, "demand limit");
      nonNegative(order.units, "demand units");
      if (order.maximumUnitPrice >= price) demand += order.units;
    }
    let cheaper = 0;
    let tied = units;
    for (const seller of input.competitors) {
      nonNegative(seller.unitPrice, "competitor price");
      nonNegative(seller.units, "competitor units");
      if (seller.unitPrice < price) cheaper += seller.units;
      else if (seller.unitPrice === price) tied += seller.units;
    }
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
  if (!Number.isFinite(markup) || markup < 0) throw new Error("Invalid target markup");
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
