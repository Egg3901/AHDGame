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
  type ProducerTradeReceipt,
  type PurchaseOrder,
} from "./rules";
import {
  accrueProducerPayable,
  settlePriorProducerPayables,
  type ProducerPayable,
} from "./payablesRules";
import { COMMODITY_SPOILAGE_PER_TURN } from "../inventory";
import { householdPurchaseOrders } from "./householdRules";
import { feasibleProduction } from "./productionFeasibilityRules";

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
  outputMultiplier: number;
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

export interface ProducerInputReservation {
  id: string;
  producerId: string;
  commodity: string;
  supplierOfferId: string;
  units: number;
  unitPrice: number;
}

export interface ProducerOperatingResult {
  id: string;
  capacityUnits: number;
  activeUnits: number;
  /** Physical proposal before funded order matching constrains actual production. */
  plannedUnits: number;
  producedUnits: number;
  offeredUnits: number;
  soldUnits: number;
  deliveredUnits: number;
  revenue: number;
  purchases: number;
  inputsConsumed: number;
  /** Acquisition value lost from unused purchased inputs; not another cash charge. */
  inventoryWriteOff: number;
  labourPaid: number;
  otherOperatingPaid: number;
  labourArrears: number;
  otherOperatingArrears: number;
  operatingArrears: number;
  arrearsPaid: number;
  closingArrears: number;
  /** Purchases move cash into input stock; only consumption is an expense. */
  profit: number;
  cashFlow: number;
  inputStock: PurchasedStock[];
  outputStock: Array<{ commodity: string; units: number; book: string }>;
  /** Receipts on the same per-turn physical basis as purchases and inventory. */
  products: Array<{
    commodity: string;
    book: string;
    producedUnits: number;
    offeredUnits: number;
    soldUnits: number;
    internalDeliveredUnits: number;
    deliveredUnits: number;
    revenue: number;
    askingUnitPrice: number;
    realizedUnitPrice: number | null;
    unsoldUnits: number;
    lostUnits: number;
  }>;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

type QuoteVolumes = Map<
  string,
  {
    levels: Map<number, number>;
    owners: Map<string, Map<number, number>>;
  }
>;

function indexQuoteVolumes(
  rows: readonly {
    commodity: string;
    book: string;
    ownerId: string;
    unitPrice: number;
    units: number;
  }[]
): QuoteVolumes {
  const books: QuoteVolumes = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.commodity, row.book]);
    const book = books.get(key) ?? { levels: new Map(), owners: new Map() };
    book.levels.set(row.unitPrice, (book.levels.get(row.unitPrice) ?? 0) + row.units);
    const owned = book.owners.get(row.ownerId) ?? new Map<number, number>();
    owned.set(row.unitPrice, (owned.get(row.unitPrice) ?? 0) + row.units);
    book.owners.set(row.ownerId, owned);
    books.set(key, book);
  }
  return books;
}

function quoteVolumesExcept(
  books: QuoteVolumes,
  commodity: string,
  bookId: string,
  ownerId: string
) {
  const book = books.get(JSON.stringify([commodity, bookId]));
  if (!book) return [];
  const owned = book.owners.get(ownerId);
  return [...book.levels].map(([unitPrice, total]) => ({
    unitPrice,
    units: Math.max(0, total - (owned?.get(unitPrice) ?? 0)),
  }));
}

/**
 * Joint production and delivery: shrink proposed production until every
 * recipe is backed by funded, delivered inputs. Each trial uses the same
 * opening cash and stock; no preview transfers money or borrows sale proceeds.
 */
export function advanceProducerEconomy(input: {
  turn: number;
  accounts: readonly MarketAccount[];
  payables?: readonly ProducerPayable[];
  producers: readonly ProductionPlan[];
  externalOffers?: readonly ProducerOffer[];
  externalOrders?: readonly PurchaseOrder[];
  inputReservations?: readonly ProducerInputReservation[];
  households?: readonly Omit<Parameters<typeof householdPurchaseOrders>[0], "cash">[];
  /** Explicit route/scope eligibility; missing entries allow only the offer's own book. */
  eligibleOffersByOrder?: Readonly<Record<string, readonly string[]>>;
  maximumPlanningPasses?: number;
  /** Explicit carry policy for alternate catalogs; ordinary worlds use commodity spoilage. */
  carryLossByCommodity?: Readonly<Record<string, number>>;
}): {
  accounts: MarketAccount[];
  payables: ProducerPayable[];
  payablePayments: ProducerPayable[];
  producers: ProducerOperatingResult[];
  tradeReceipt: ProducerTradeReceipt;
  prices: ReturnType<typeof settleProducerMarket>["prices"];
} {
  const carryRates: Readonly<Record<string, number>> =
    input.carryLossByCommodity ?? COMMODITY_SPOILAGE_PER_TURN;
  const carryLoss = (commodity: string) => {
    const rate = carryRates[commodity] ?? 0;
    if (!Number.isFinite(rate) || rate < 0 || rate > 1)
      throw new Error("Invalid inventory carry loss");
    return rate;
  };
  const prior = settlePriorProducerPayables({
    accounts: input.accounts,
    payables: input.payables ?? [],
  });
  const closingPayables = new Map(prior.payables.map((claim) => [claim.id, claim]));
  const oldBillsPaidByProducer = new Map<string, number>();
  const oldBillsRemainingByProducer = new Map<string, number>();
  for (const payment of prior.payments) {
    const key = JSON.stringify([payment.debtorAccountId, payment.producerId]);
    oldBillsPaidByProducer.set(key, (oldBillsPaidByProducer.get(key) ?? 0) + payment.amount);
  }
  for (const claim of prior.payables) {
    const key = JSON.stringify([claim.debtorAccountId, claim.producerId]);
    oldBillsRemainingByProducer.set(
      key,
      (oldBillsRemainingByProducer.get(key) ?? 0) + claim.amount
    );
  }
  const producerIds = new Set<string>();
  const cash = new Map(prior.accounts.map((a) => [a.id, finite(a.cash, "opening operating cash")]));
  const pendingDueByAccount = new Map<string, number>();
  for (const claim of prior.payables)
    pendingDueByAccount.set(
      claim.debtorAccountId,
      (pendingDueByAccount.get(claim.debtorAccountId) ?? 0) + claim.amount
    );
  const heldForPayables = new Map<string, number>();
  const reserveUnpaidCash = () => {
    for (const [id, due] of pendingDueByAccount) {
      const held = heldForPayables.get(id) ?? 0;
      const added = Math.min(cash.get(id)!, Math.max(0, due - held));
      cash.set(id, cash.get(id)! - added);
      heldForPayables.set(id, held + added);
    }
  };
  reserveUnpaidCash();
  const payments = new Map<string, { labour: number; operating: number; arrears: number }>();
  const offers: ProducerOffer[] = [...(input.externalOffers ?? [])];
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
      !Number.isFinite(p.outputMultiplier) ||
      p.outputMultiplier < 0
    )
      throw new Error("Invalid capacity fraction");
    finite(p.capacityUnits * p.activeFraction * p.outputMultiplier, "physical output");
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
      if (
        !outputCommodities.has(stock.commodity) ||
        !p.outputs.some(
          (output) => output.commodity === stock.commodity && output.book === stock.book
        )
      )
        throw new Error("Unrecognized produced stock or market book");
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
    pendingDueByAccount.set(
      p.accountId,
      (pendingDueByAccount.get(p.accountId) ?? 0) +
        Math.max(0, p.labourCost - labour) +
        Math.max(0, p.otherOperatingCost - operating)
    );
    payments.set(p.id, {
      labour,
      operating,
      arrears: Math.max(0, p.labourCost - labour) + Math.max(0, p.otherOperatingCost - operating),
    });
  }
  // Paid wages are actual income, not an invented household demand multiplier.
  for (const [id, amount] of credits) cash.set(id, cash.get(id)! + amount);
  reserveUnpaidCash();
  const householdIds = new Set<string>();
  const consumerOrders = [...(input.externalOrders ?? [])];
  for (const household of input.households ?? []) {
    if (householdIds.has(household.accountId) || !cash.has(household.accountId))
      throw new Error("Duplicate or unknown household wallet");
    householdIds.add(household.accountId);
    consumerOrders.push(
      ...householdPurchaseOrders({ ...household, cash: cash.get(household.accountId)! })
    );
  }
  const orders = [...consumerOrders];
  const originalCash = new Map(input.accounts.map((a) => [a.id, a.cash]));
  const plannedById = new Map(
    plans.map((p) => [
      p.id,
      p.capacityUnits * p.activeFraction * p.outputMultiplier * (funding.get(p.accountId) ?? 1),
    ])
  );
  // Find a physically feasible mix before buyers reserve inputs. Otherwise an
  // early final producer can take the energy needed by the steel supplier that
  // makes its own inputs, and a greedy shrink pass strands the entire cycle.
  // Each segment ends when one owned input is exhausted. Its marginal input
  // requirement is constant. This retains partial batches without ever treating
  // private purchased stock as a shared commodity endowment.
  const segments = plans.flatMap((p) => {
    const maximum = plannedById.get(p.id)!;
    const owned = new Map(
      p.inputs.map((r) => [
        r.commodity,
        p.inputStock
          .filter((s) => s.commodity === r.commodity)
          .reduce((sum, s) => sum + s.units, 0),
      ])
    );
    const boundaries = new Set([0, 1]);
    for (const r of p.inputs) {
      const required = maximum * r.unitsPerOutput;
      const fraction = required > 0 ? (owned.get(r.commodity) ?? 0) / required : 0;
      if (fraction > 0 && fraction < 1) boundaries.add(fraction);
    }
    const points = [...boundaries].sort((a, b) => a - b);
    return points.slice(1).map((to, j) => ({
      id: JSON.stringify([p.id, j]),
      plan: p,
      owned,
      from: points[j] * maximum,
      to: to * maximum,
      units: (to - points[j]) * maximum,
    }));
  });
  const resources = new Map<string, { available: number; coefficients: number[] }>();
  const resource = (commodity: string, book: string) => {
    const key = JSON.stringify([commodity, book]);
    let row = resources.get(key);
    if (!row) {
      row = { available: 0, coefficients: Array(segments.length).fill(0) };
      resources.set(key, row);
    }
    return row;
  };
  for (const [j, segment] of segments.entries()) {
    for (const recipe of segment.plan.inputs) {
      const owned = segment.owned.get(recipe.commodity) ?? 0;
      resource(recipe.commodity, recipe.book).coefficients[j] +=
        Math.max(0, segment.to * recipe.unitsPerOutput - owned) -
        Math.max(0, segment.from * recipe.unitsPerOutput - owned);
    }
    for (const output of segment.plan.outputs)
      resource(output.commodity, output.book).coefficients[j] -=
        segment.units * output.unitsPerOutput;
  }
  for (const p of plans)
    for (const output of p.outputs)
      resource(output.commodity, output.book).available += p.outputStock
        .filter((s) => s.commodity === output.commodity && s.book === output.book)
        .reduce((sum, s) => sum + s.units, 0);
  for (const offer of input.externalOffers ?? [])
    resource(offer.commodity, offer.book).available += Math.min(
      offer.units,
      offer.deliverableUnits ?? offer.units
    );
  const feasible = feasibleProduction({
    activities: segments.map((s) => ({
      id: s.id,
      value:
        s.units *
        s.plan.outputs.reduce((sum, o) => sum + o.unitsPerOutput * o.referenceUnitPrice, 0),
    })),
    constraints: [...resources.values()],
  });
  for (const p of plans) plannedById.set(p.id, 0);
  for (const [j, segment] of segments.entries())
    plannedById.set(
      segment.plan.id,
      plannedById.get(segment.plan.id)! + segment.units * feasible[j]
    );
  const proposedById = new Map(plannedById);
  const reservations = new Map<string, ProducerInputReservation[]>();
  const plansById = new Map(plans.map((plan) => [plan.id, plan]));
  const reservationIds = new Set<string>();
  for (const reservation of input.inputReservations ?? []) {
    if (!reservation.id || reservationIds.has(reservation.id) || !reservation.supplierOfferId)
      throw new Error("Invalid input reservation identity");
    reservationIds.add(reservation.id);
    finite(reservation.units, "reserved units");
    finite(reservation.unitPrice, "reserved price");
    const plan = plansById.get(reservation.producerId);
    if (!plan?.inputs.some((recipe) => recipe.commodity === reservation.commodity))
      throw new Error("Input reservation has no matching recipe");
    const key = JSON.stringify([reservation.producerId, "input", reservation.commodity]);
    const rows = reservations.get(key) ?? [];
    rows.push(reservation);
    reservations.set(key, rows);
  }
  const orderIdsForInput = (producerId: string, commodity: string) => {
    const id = JSON.stringify([producerId, "input", commodity]);
    return [
      id,
      ...(reservations.get(id) ?? []).map((r) => JSON.stringify([id, "reservation", r.id])),
    ];
  };
  const inputOrders = (): PurchaseOrder[] =>
    plans.flatMap((p) =>
      p.inputs.flatMap((recipe) => {
        const stock = p.inputStock
          .filter((s) => s.commodity === recipe.commodity)
          .reduce((n, s) => n + s.units, 0);
        const id = JSON.stringify([p.id, "input", recipe.commodity]);
        const units = Math.max(0, plannedById.get(p.id)! * recipe.unitsPerOutput - stock);
        const reserved = reservations.get(id) ?? [];
        const quantityGroup = reserved.length ? { id, maximumUnits: units } : undefined;
        const publicOrder: PurchaseOrder = {
          id,
          accountId: p.accountId,
          commodity: recipe.commodity,
          book: recipe.book,
          units,
          maximumUnitPrice: recipe.maximumUnitPrice,
          priority: 1,
          eligibleOfferIds: input.eligibleOffersByOrder?.[id],
          ...(quantityGroup ? { quantityGroup } : {}),
        };
        return [
          publicOrder,
          ...reserved.map((reservation): PurchaseOrder => {
            const reservedId = JSON.stringify([id, "reservation", reservation.id]);
            return {
              ...publicOrder,
              id: reservedId,
              units: Math.min(units, reservation.units),
              maximumUnitPrice: reservation.unitPrice,
              contractUnitPrice: reservation.unitPrice,
              supplierOfferId: reservation.supplierOfferId,
              eligibleOfferIds:
                input.eligibleOffersByOrder?.[reservedId] ?? publicOrder.eligibleOfferIds,
            };
          }),
        ];
      })
    );
  orders.push(...inputOrders());
  const pendingQuotes: Array<{ offer: ProducerOffer; quote: Parameters<typeof quoteProducer>[0] }> =
    [];
  const requestedSpend = new Map<string, number>();
  const groupedSpend = new Map<string, { accountId: string; maximumSpend: number }>();
  for (const order of orders) {
    if (order.quantityGroup) {
      const group = groupedSpend.get(order.quantityGroup.id);
      groupedSpend.set(order.quantityGroup.id, {
        accountId: order.accountId,
        maximumSpend: Math.max(
          group?.maximumSpend ?? 0,
          order.quantityGroup.maximumUnits * order.maximumUnitPrice
        ),
      });
      continue;
    }
    requestedSpend.set(
      order.accountId,
      (requestedSpend.get(order.accountId) ?? 0) +
        Math.min(order.units * order.maximumUnitPrice, order.maximumSpend ?? Number.MAX_VALUE)
    );
  }
  for (const group of groupedSpend.values())
    requestedSpend.set(
      group.accountId,
      (requestedSpend.get(group.accountId) ?? 0) + group.maximumSpend
    );
  // Aggregate identical limits once. Retaining one demand object per buyer
  // per seller makes an otherwise modest world use quadratic memory.
  const demandBooks = indexQuoteVolumes(
    orders
      .filter((order) => !order.supplierOfferId)
      .map((order) => ({
        commodity: order.commodity,
        book: order.book,
        ownerId: order.accountId,
        unitPrice: order.maximumUnitPrice,
        units:
          Math.min(
            order.units,
            order.maximumUnitPrice > 0
              ? (order.maximumSpend ?? Number.MAX_VALUE) / order.maximumUnitPrice
              : order.units
          ) *
          Math.min(
            1,
            (cash.get(order.accountId) ?? 0) /
              Math.max(Number.MIN_VALUE, requestedSpend.get(order.accountId) ?? 0)
          ),
      }))
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
        demand: quoteVolumesExcept(demandBooks, output.commodity, output.book, p.accountId).map(
          (level) => ({ units: level.units, maximumUnitPrice: level.unitPrice })
        ),
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
  const supplyBooks = indexQuoteVolumes(
    openingOffers.map((offer) => ({ ...offer, ownerId: offer.id }))
  );
  for (const pending of pendingQuotes) {
    const quote = quoteProducer({
      ...pending.quote,
      competitors: quoteVolumesExcept(
        supplyBooks,
        pending.offer.commodity,
        pending.offer.book,
        pending.offer.id
      ),
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
      orders: [...consumerOrders, ...inputOrders()],
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
          (stock +
            orderIdsForInput(p.id, recipe.commodity).reduce(
              (sum, id) => sum + (bought.get(id) ?? 0),
              0
            )) /
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
  const closingAccounts = market.accounts.map((account) => ({
    ...account,
    cash: account.cash + (heldForPayables.get(account.id) ?? 0),
  }));
  const closingCash = new Map(closingAccounts.map((a) => [a.id, a.cash]));
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
      const bought = orderIdsForInput(p.id, recipe.commodity).reduce(
        (total, id) => {
          const order = ordersById.get(id)!;
          return {
            deliveredUnits: total.deliveredUnits + order.deliveredUnits,
            cost: total.cost + order.cost,
          };
        },
        { deliveredUnits: 0, cost: 0 }
      );
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
      const exhausted = used >= stock.units * (1 - 1e-12);
      const cost = exhausted
        ? stock.value
        : stock.units > 0
          ? (stock.value * used) / stock.units
          : 0;
      stock.units = exhausted ? 0 : Math.max(0, stock.units - used);
      stock.value = exhausted ? 0 : Math.max(0, stock.value - cost);
      consumed += cost;
    }
    let inventoryWriteOff = 0;
    for (const stock of stocks.values()) {
      const loss = carryLoss(stock.commodity);
      inventoryWriteOff += stock.value * loss;
      stock.units *= 1 - loss;
      stock.value *= 1 - loss;
    }
    let revenue = 0,
      offeredUnits = 0,
      soldUnits = 0,
      deliveredUnits = 0;
    const products: ProducerOperatingResult["products"] = [];
    const outputStock = p.outputs.map((output) => {
      const sold = offersById.get(JSON.stringify([p.id, "output", output.commodity]))!;
      revenue += sold.revenue;
      offeredUnits += sold.offeredUnits;
      soldUnits += sold.soldUnits;
      deliveredUnits += sold.deliveredUnits;
      const opening = p.outputStock
        .filter((s) => s.commodity === output.commodity && s.book === output.book)
        .reduce((n, s) => n + s.units, 0);
      const available = opening + produced * output.unitsPerOutput;
      if (sold.deliveredUnits - available > Math.max(1e-8, available * 1e-12))
        throw new Error("Sold output exceeded input-backed production");
      const unsold = Math.max(0, available - sold.deliveredUnits);
      const kept =
        output.storable && sold.deliveredUnits < available * (1 - 1e-12)
          ? unsold * (1 - carryLoss(output.commodity))
          : 0;
      products.push({
        commodity: output.commodity,
        book: output.book,
        producedUnits: produced * output.unitsPerOutput,
        offeredUnits: sold.offeredUnits,
        soldUnits: sold.soldUnits,
        internalDeliveredUnits: sold.internalDeliveredUnits,
        deliveredUnits: sold.deliveredUnits,
        revenue: sold.revenue,
        askingUnitPrice: postedOffers.get(JSON.stringify([p.id, "output", output.commodity]))!
          .unitPrice,
        realizedUnitPrice: sold.soldUnits > 0 ? sold.revenue / sold.soldUnits : null,
        unsoldUnits: unsold,
        lostUnits: unsold - kept,
      });
      return {
        commodity: output.commodity,
        book: output.book,
        units: kept,
      };
    });
    const paid = payments.get(p.id)!;
    const payableKey = JSON.stringify([p.accountId, p.id]);
    const arrearsPaid = oldBillsPaidByProducer.get(payableKey) ?? 0;
    accrueProducerPayable(closingPayables, {
      debtorAccountId: p.accountId,
      creditorAccountId: p.labourRecipientAccountId,
      producerId: p.id,
      kind: "labour",
      amount: Math.max(0, p.labourCost - paid.labour),
    });
    accrueProducerPayable(closingPayables, {
      debtorAccountId: p.accountId,
      creditorAccountId: p.operatingRecipientAccountId,
      producerId: p.id,
      kind: "operating",
      amount: Math.max(0, p.otherOperatingCost - paid.operating),
    });
    const closingArrears = (oldBillsRemainingByProducer.get(payableKey) ?? 0) + paid.arrears;

    finite(
      consumed + inventoryWriteOff + p.labourCost + p.otherOperatingCost,
      "production expense"
    );
    results.push({
      id: p.id,
      capacityUnits: p.capacityUnits,
      activeUnits: p.capacityUnits * p.activeFraction,
      plannedUnits: proposedById.get(p.id)!,
      producedUnits: produced,
      offeredUnits,
      soldUnits,
      deliveredUnits,
      revenue,
      purchases,
      inputsConsumed: consumed,
      inventoryWriteOff,
      labourPaid: paid.labour,
      otherOperatingPaid: paid.operating,
      labourArrears: p.labourCost - paid.labour,
      otherOperatingArrears: p.otherOperatingCost - paid.operating,
      operatingArrears: paid.arrears,
      arrearsPaid,
      closingArrears,
      profit: revenue - consumed - inventoryWriteOff - p.labourCost - p.otherOperatingCost,
      cashFlow: revenue - purchases - paid.labour - paid.operating - arrearsPaid,
      inputStock: [...stocks.values()],
      outputStock,
      products,
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
    accounts: closingAccounts,
    payables: [...closingPayables.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    ),
    payablePayments: prior.payments,
    producers: results,
    tradeReceipt: market.tradeReceipt,
    prices: market.prices,
  };
}
