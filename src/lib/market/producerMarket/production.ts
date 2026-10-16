/**
 * Plants turn purchased inputs and paid work into deliverable output.
 * Input shortages constrain the whole recipe; purchases and consumed stock
 * retain their receipt cost instead of being billed again at a reference price.
 */
import {
  quoteProducer,
  settleProducerMarket,
  type MarketAccount,
  type ProducerOffer,
  type ProducerQuotePolicy,
  type ProducerTrade,
  type PurchaseOrder,
} from "./rules";

export interface PurchasedStock {
  commodity: string;
  units: number;
  /** Remaining acquisition value, in the same currency as market accounts. */
  value: number;
}

export interface ProductionPlan {
  id: string;
  accountId: string;
  capacityUnits: number;
  activeFraction: number;
  /** Prior staffing, disasters and other physical constraints, excluding demand. */
  physicalFraction: number;
  inputs: readonly {
    commodity: string;
    unitsPerOutput: number;
    book: string;
    maximumUnitPrice: number;
  }[];
  outputs: readonly {
    commodity: string;
    unitsPerOutput: number;
    book: string;
    policy: ProducerQuotePolicy;
    referenceUnitPrice: number;
    storable: boolean;
  }[];
  /** Cash payment for the active workforce, independent of realized sales. */
  labourCost: number;
  /** Explicit site, cold-capacity and regulatory costs, independent of product prices. */
  otherOperatingCost: number;
  labourRecipientAccountId: string;
  operatingRecipientAccountId: string;
  inputStock: readonly PurchasedStock[];
  /** Previously produced, unsold stock available beside current production. */
  outputStock: readonly { commodity: string; units: number; book: string }[];
}

export interface ProducerOperatingResult {
  id: string;
  capacityUnits: number;
  activeUnits: number;
  producedUnits: number;
  offeredUnits: number;
  deliveredUnits: number;
  revenue: number;
  purchases: number;
  inputsConsumed: number;
  labourPaid: number;
  otherOperatingPaid: number;
  operatingArrears: number;
  /** Purchases move cash into input stock; only consumption is an expense. */
  profit: number;
  cashFlow: number;
  inputStock: PurchasedStock[];
  outputStock: Array<{ commodity: string; units: number; book: string }>;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

/**
 * Joint production and delivery: shrink proposed production until every
 * recipe is backed by funded, delivered inputs. Each trial uses the same
 * opening cash and stock; no preview transfers money or borrows sale proceeds.
 */
export function advanceProducerEconomy(input: {
  turn: number;
  accounts: readonly MarketAccount[];
  producers: readonly ProductionPlan[];
  externalOffers?: readonly ProducerOffer[];
  externalOrders?: readonly PurchaseOrder[];
  /** Explicit route/scope eligibility; missing entries allow only the offer's own book. */
  eligibleOffersByOrder?: Readonly<Record<string, readonly string[]>>;
  maximumPlanningPasses?: number;
}): {
  accounts: MarketAccount[];
  producers: ProducerOperatingResult[];
  trades: ProducerTrade[];
  prices: ReturnType<typeof settleProducerMarket>["prices"];
} {
  const producerIds = new Set<string>();
  const cash = new Map(input.accounts.map((a) => [a.id, finite(a.cash, "opening operating cash")]));
  if (cash.size !== input.accounts.length) throw new Error("Duplicate operating account");
  const payments = new Map<string, { labour: number; operating: number; arrears: number }>();
  const offers: ProducerOffer[] = [...(input.externalOffers ?? [])];
  const orders: PurchaseOrder[] = [...(input.externalOrders ?? [])];
  const plans = [...input.producers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Reserve fixed bills across a whole corporation pro rata, not by sector id.
  const bills = new Map<string, number>();
  for (const p of plans) {
    if (!p.id || producerIds.has(p.id)) throw new Error("Duplicate producer");
    producerIds.add(p.id);
    for (const id of [p.accountId, p.labourRecipientAccountId, p.operatingRecipientAccountId])
      if (!cash.has(id)) throw new Error("Missing operating account");
    finite(p.capacityUnits, "capacity");
    if (
      !Number.isFinite(p.activeFraction) ||
      p.activeFraction < 0 ||
      p.activeFraction > 1 ||
      !Number.isFinite(p.physicalFraction) ||
      p.physicalFraction < 0 ||
      p.physicalFraction > 1
    )
      throw new Error("Invalid capacity fraction");
    bills.set(
      p.accountId,
      (bills.get(p.accountId) ?? 0) +
        finite(p.labourCost, "labour cost") +
        finite(p.otherOperatingCost, "operating cost")
    );
    const commodities = new Set<string>();
    for (const recipe of p.inputs) {
      if (commodities.has(recipe.commodity)) throw new Error("Duplicate input recipe");
      commodities.add(recipe.commodity);
      finite(recipe.unitsPerOutput, "input recipe");
      finite(recipe.maximumUnitPrice, "input limit");
    }
    for (const stock of p.inputStock) {
      finite(stock.units, "input stock");
      finite(stock.value, "stock value");
      if (stock.units === 0 && stock.value !== 0) throw new Error("Value without purchased units");
    }
    const outputCommodities = new Set<string>();
    for (const output of p.outputs) {
      if (outputCommodities.has(output.commodity)) throw new Error("Duplicate output recipe");
      outputCommodities.add(output.commodity);
      finite(output.unitsPerOutput, "output recipe");
      finite(output.referenceUnitPrice, "reference price");
    }
    for (const stock of p.outputStock) {
      finite(stock.units, "output stock");
      if (!outputCommodities.has(stock.commodity)) throw new Error("Unrecognized produced stock");
    }
  }
  const funding = new Map(
    [...bills].map(([id, bill]) => [id, bill > 0 ? Math.min(1, cash.get(id)! / bill) : 1])
  );
  const credits = new Map<string, number>();
  for (const p of plans) {
    const fraction = funding.get(p.accountId)!;
    const labour = p.labourCost * fraction,
      operating = p.otherOperatingCost * fraction;
    cash.set(p.accountId, Math.max(0, cash.get(p.accountId)! - labour - operating));
    credits.set(
      p.labourRecipientAccountId,
      (credits.get(p.labourRecipientAccountId) ?? 0) + labour
    );
    credits.set(
      p.operatingRecipientAccountId,
      (credits.get(p.operatingRecipientAccountId) ?? 0) + operating
    );
    payments.set(p.id, {
      labour,
      operating,
      arrears: p.labourCost + p.otherOperatingCost - labour - operating,
    });
  }
  // Paid wages are actual income, not an invented household demand multiplier.
  for (const [id, amount] of credits) cash.set(id, cash.get(id)! + amount);
  const originalCash = new Map(input.accounts.map((a) => [a.id, a.cash]));
  const plannedById = new Map(
    plans.map((p) => [
      p.id,
      p.capacityUnits * p.activeFraction * p.physicalFraction * (funding.get(p.accountId) ?? 1),
    ])
  );
  const inputOrders = () =>
    plans.flatMap((p) =>
      p.inputs.map((recipe) => {
        const stock = p.inputStock
          .filter((s) => s.commodity === recipe.commodity)
          .reduce((n, s) => n + s.units, 0);
        const id = JSON.stringify([p.id, "input", recipe.commodity]);
        return {
          id,
          accountId: p.accountId,
          commodity: recipe.commodity,
          book: recipe.book,
          units: Math.max(0, plannedById.get(p.id)! * recipe.unitsPerOutput - stock),
          maximumUnitPrice: recipe.maximumUnitPrice,
          eligibleOfferIds: input.eligibleOffersByOrder?.[id],
        };
      })
    );
  orders.push(...inputOrders());
  const pendingQuotes: Array<{ offer: ProducerOffer; quote: Parameters<typeof quoteProducer>[0] }> =
    [];
  const requestedSpend = new Map<string, number>();
  for (const order of orders)
    requestedSpend.set(
      order.accountId,
      (requestedSpend.get(order.accountId) ?? 0) + order.units * order.maximumUnitPrice
    );
  for (const p of plans) {
    const fixed = p.labourCost + p.otherOperatingCost;
    const variablePerOutput = p.inputs.reduce(
      (n, r) => n + r.unitsPerOutput * r.maximumUnitPrice,
      0
    );
    const outputValue = p.outputs.reduce((n, r) => n + r.unitsPerOutput * r.referenceUnitPrice, 0);
    for (const output of p.outputs) {
      const stock = p.outputStock
        .filter((s) => s.commodity === output.commodity && s.book === output.book)
        .reduce((n, s) => n + s.units, 0);
      const units = stock + plannedById.get(p.id)! * output.unitsPerOutput;
      const weight =
        outputValue > 0 ? (output.unitsPerOutput * output.referenceUnitPrice) / outputValue : 0;
      const quoteInput = {
        policy: output.policy,
        referenceUnitPrice: output.referenceUnitPrice,
        variableUnitCost:
          output.unitsPerOutput > 0 ? (variablePerOutput * weight) / output.unitsPerOutput : 0,
        fixedCost: fixed * weight,
        offeredUnits: units,
        demand: orders
          .filter(
            (o) =>
              o.commodity === output.commodity &&
              o.book === output.book &&
              o.accountId !== p.accountId
          )
          .map((o) => ({
            units:
              o.units *
              Math.min(
                1,
                (cash.get(o.accountId) ?? 0) /
                  Math.max(Number.MIN_VALUE, requestedSpend.get(o.accountId) ?? 0)
              ),
            maximumUnitPrice: o.maximumUnitPrice,
          })),
        competitors: [],
      };
      const quote = quoteProducer({
        ...quoteInput,
        policy:
          output.policy.kind === "automatic"
            ? { kind: "manual", unitPrice: output.referenceUnitPrice }
            : output.policy,
      });
      pendingQuotes.push({
        offer: {
          id: JSON.stringify([p.id, "output", output.commodity]),
          accountId: p.accountId,
          commodity: output.commodity,
          book: output.book,
          units,
          unitPrice: quote.unitPrice,
        },
        quote: quoteInput,
      });
    }
  }
  const openingOffers = [...offers, ...pendingQuotes.map((q) => q.offer)];
  for (const pending of pendingQuotes) {
    const quote = quoteProducer({
      ...pending.quote,
      competitors: openingOffers
        .filter(
          (o) =>
            o.commodity === pending.offer.commodity &&
            o.book === pending.offer.book &&
            o.id !== pending.offer.id
        )
        .map((o) => ({ units: o.units, unitPrice: o.unitPrice })),
    });
    offers.push({ ...pending.offer, unitPrice: quote.unitPrice });
  }
  const postedOffers = new Map(offers.map((o) => [o.id, o]));
  const trial = () => {
    const proposedOffers: ProducerOffer[] = [...(input.externalOffers ?? [])];
    for (const p of plans)
      for (const output of p.outputs) {
        const id = JSON.stringify([p.id, "output", output.commodity]);
        const stock = p.outputStock
          .filter((s) => s.commodity === output.commodity && s.book === output.book)
          .reduce((n, s) => n + s.units, 0);
        proposedOffers.push({
          ...postedOffers.get(id)!,
          units: stock + plannedById.get(p.id)! * output.unitsPerOutput,
        });
      }
    return settleProducerMarket({
      turn: input.turn,
      accounts: [...cash].map(([id, value]) => ({ id, cash: value })),
      offers: proposedOffers,
      orders: [...(input.externalOrders ?? []), ...inputOrders()],
    });
  };
  let market: ReturnType<typeof settleProducerMarket> | undefined;
  const passes = input.maximumPlanningPasses ?? 128;
  if (!Number.isSafeInteger(passes) || passes < 1 || passes > 1024)
    throw new Error("Invalid planning-pass limit");
  for (let pass = 0; pass < passes; pass++) {
    market = trial();
    const bought = new Map(market.orders.map((o) => [o.id, o.deliveredUnits]));
    let changed = false;
    for (const p of plans) {
      const previous = plannedById.get(p.id)!;
      let supported = previous;
      for (const recipe of p.inputs) {
        if (!(recipe.unitsPerOutput > 0)) continue;
        const stock = p.inputStock
          .filter((s) => s.commodity === recipe.commodity)
          .reduce((n, s) => n + s.units, 0);
        supported = Math.min(
          supported,
          (stock + (bought.get(JSON.stringify([p.id, "input", recipe.commodity])) ?? 0)) /
            recipe.unitsPerOutput
        );
      }
      if (previous - supported > Math.max(1e-9, previous * 1e-12)) changed = true;
      plannedById.set(p.id, Math.max(0, supported));
    }
    if (!changed) break;
    if (pass === passes - 1) throw new Error("Production and funded deliveries did not converge");
  }
  if (!market) throw new Error("Missing producer market settlement");
  const results: ProducerOperatingResult[] = [];
  const offersById = new Map(market.offers.map((o) => [o.id, o]));
  const ordersById = new Map(market.orders.map((o) => [o.id, o]));
  const closingCash = new Map(market.accounts.map((a) => [a.id, a.cash]));
  for (const p of plans) {
    const stocks = new Map<string, PurchasedStock>();
    for (const stock of p.inputStock) {
      const previous = stocks.get(stock.commodity) ?? {
        commodity: stock.commodity,
        units: 0,
        value: 0,
      };
      previous.units += stock.units;
      previous.value += stock.value;
      stocks.set(stock.commodity, previous);
    }
    let purchases = 0;
    for (const recipe of p.inputs) {
      const bought = ordersById.get(JSON.stringify([p.id, "input", recipe.commodity]))!;
      const stock = stocks.get(recipe.commodity) ?? {
        commodity: recipe.commodity,
        units: 0,
        value: 0,
      };
      stock.units += bought.deliveredUnits;
      stock.value += bought.cost;
      purchases += bought.cost;
      stocks.set(recipe.commodity, stock);
    }
    let produced = plannedById.get(p.id)!;
    for (const recipe of p.inputs)
      if (recipe.unitsPerOutput > 0)
        produced = Math.min(
          produced,
          (stocks.get(recipe.commodity)?.units ?? 0) / recipe.unitsPerOutput
        );
    let consumed = 0;
    for (const recipe of p.inputs) {
      const stock = stocks.get(recipe.commodity)!;
      const used = produced * recipe.unitsPerOutput;
      const cost = stock.units > 0 ? (stock.value * used) / stock.units : 0;
      stock.units = Math.max(0, stock.units - used);
      stock.value = Math.max(0, stock.value - cost);
      consumed += cost;
    }
    let revenue = 0,
      offeredUnits = 0,
      deliveredUnits = 0;
    const outputStock = p.outputs.map((output) => {
      const sold = offersById.get(JSON.stringify([p.id, "output", output.commodity]))!;
      revenue += sold.revenue;
      offeredUnits += sold.offeredUnits;
      deliveredUnits += sold.deliveredUnits;
      const opening = p.outputStock
        .filter((s) => s.commodity === output.commodity && s.book === output.book)
        .reduce((n, s) => n + s.units, 0);
      const available = opening + produced * output.unitsPerOutput;
      if (sold.deliveredUnits - available > Math.max(1e-8, available * 1e-12))
        throw new Error("Sold output exceeded input-backed production");
      return {
        commodity: output.commodity,
        book: output.book,
        units: output.storable ? Math.max(0, available - sold.deliveredUnits) : 0,
      };
    });
    const paid = payments.get(p.id)!;
    results.push({
      id: p.id,
      capacityUnits: p.capacityUnits,
      activeUnits: p.capacityUnits * p.activeFraction,
      producedUnits: produced,
      offeredUnits,
      deliveredUnits,
      revenue,
      purchases,
      inputsConsumed: consumed,
      labourPaid: paid.labour,
      otherOperatingPaid: paid.operating,
      operatingArrears: paid.arrears,
      profit: revenue - consumed - paid.labour - paid.operating,
      cashFlow: revenue - purchases - paid.labour - paid.operating,
      inputStock: [...stocks.values()],
      outputStock,
    });
  }
  const openingTotal = [...originalCash.values()].reduce((n, v) => n + v, 0);
  const closingTotal = [...closingCash.values()].reduce((n, v) => n + v, 0);
  if (
    !Number.isFinite(closingTotal) ||
    Math.abs(openingTotal - closingTotal) > Math.max(1e-7, Math.abs(openingTotal) * 1e-12)
  )
    throw new Error("Producer market cash did not reconcile");
  return {
    accounts: market.accounts,
    producers: results,
    trades: market.trades,
    prices: market.prices,
  };
}
