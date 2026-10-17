import { describe, expect, it } from "vitest";
import { producerTrades, quoteProducer, settleProducerMarket } from "./rules";

describe("one funded producer market", () => {
  it("credits an actual small sale without subtracting rounded huge stock values to infer revenue", () => {
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "buyer", cash: 5 },
        { id: "seller", cash: 0 },
      ],
      offers: [
        {
          id: "stock",
          accountId: "seller",
          commodity: "goods",
          book: "world",
          units: 1e20,
          unitPrice: 5,
        },
      ],
      orders: [
        {
          id: "purchase",
          accountId: "buyer",
          commodity: "goods",
          book: "world",
          units: 1,
          maximumUnitPrice: 5,
        },
      ],
    });
    expect(result.accounts).toEqual([
      { id: "buyer", cash: 0 },
      { id: "seller", cash: 5 },
    ]);
    expect(result.offers[0]).toMatchObject({ soldUnits: 1, revenue: 5 });
    expect([...producerTrades(result.tradeReceipt)][0]).toMatchObject({ units: 1, amount: 5 });
  });

  it("matches individual supplier matching across pooled sales, own stock and intervening contracts", () => {
    let seed = 1587;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    for (let example = 0; example < 100; example++) {
      const accounts = Array.from({ length: 5 }, (_, i) => ({
        id: `account:${i}`,
        cash: next() % 100,
      }));
      const offers = Array.from({ length: 15 }, (_, i) => ({
        id: `offer:${i}`,
        accountId: accounts[next() % 5].id,
        commodity: "goods",
        book: "world",
        units: next() % 20,
        unitPrice: next() % 5,
      }));
      const orders = Array.from({ length: 12 }, (_, i) => ({
        id: `order:${i}`,
        accountId: accounts[next() % 5].id,
        commodity: "goods",
        book: "world",
        units: next() % 25,
        maximumUnitPrice: Math.max(i % 3 === 0 ? 1 : 0, next() % 6),
        ...(i % 3 === 0
          ? { supplierOfferId: offers[next() % offers.length].id, contractUnitPrice: 1 }
          : {}),
      }));
      const pooled = settleProducerMarket({ turn: 1, accounts, offers, orders });
      const individual = settleProducerMarket({
        turn: 1,
        accounts,
        offers,
        orders: orders.map((order) => ({
          ...order,
          eligibleOfferIds: offers.map((offer) => offer.id),
        })),
      });
      for (let i = 0; i < accounts.length; i++)
        expect(pooled.accounts[i].cash).toBeCloseTo(individual.accounts[i].cash, 8);
      for (let i = 0; i < offers.length; i++) {
        expect(pooled.offers[i].deliveredUnits).toBeCloseTo(individual.offers[i].deliveredUnits, 8);
        expect(pooled.offers[i].revenue).toBeCloseTo(individual.offers[i].revenue, 8);
      }
      for (let i = 0; i < orders.length; i++) {
        expect(pooled.orders[i].deliveredUnits).toBeCloseTo(individual.orders[i].deliveredUnits, 8);
        expect(pooled.orders[i].cost).toBeCloseTo(individual.orders[i].cost, 8);
      }
      const trades = [...producerTrades(pooled.tradeReceipt)];
      expect(trades.reduce((sum, trade) => sum + trade.amount, 0)).toBeCloseTo(
        pooled.orders.reduce((sum, order) => sum + order.cost, 0),
        8
      );
    }
  });

  it("uses the same delivered trade for seller revenue, buyer cost and the observed price", () => {
    const result = settleProducerMarket({
      turn: 7,
      accounts: [
        { id: "finance", cash: 0 },
        { id: "industry", cash: 150 },
      ],
      offers: [
        {
          id: "service",
          accountId: "finance",
          commodity: "financial_services",
          book: "world",
          units: 100,
          unitPrice: 2,
          deliverableUnits: 60,
        },
      ],
      orders: [
        {
          id: "input",
          accountId: "industry",
          commodity: "financial_services",
          book: "world",
          units: 100,
          maximumUnitPrice: 2,
        },
      ],
    });
    expect([...producerTrades(result.tradeReceipt)]).toEqual([
      expect.objectContaining({ units: 60, unitPrice: 2, amount: 120 }),
    ]);
    expect(result.offers[0]).toMatchObject({ deliveredUnits: 60, revenue: 120 });
    expect(result.orders[0]).toMatchObject({ deliveredUnits: 60, cost: 120 });
    expect(result.accounts).toEqual([
      { id: "finance", cash: 120 },
      { id: "industry", cash: 30 },
    ]);
    expect(result.prices[0]).toMatchObject({ unitPrice: 2, units: 60, value: 120 });
  });

  it("retains exact supplier trades in linear receipt space for a wide equal-price book", () => {
    const count = 300;
    const result = settleProducerMarket({
      turn: 1,
      accounts: Array.from({ length: count }, (_, i) => [
        { id: `buyer:${i}`, cash: 1 },
        { id: `seller:${i}`, cash: 0 },
      ]).flat(),
      offers: Array.from({ length: count }, (_, i) => ({
        id: `offer:${i}`,
        accountId: `seller:${i}`,
        commodity: "goods",
        book: "world",
        units: 1,
        unitPrice: 1,
      })),
      orders: Array.from({ length: count }, (_, i) => ({
        id: `order:${i}`,
        accountId: `buyer:${i}`,
        commodity: "goods",
        book: "world",
        units: 1,
        maximumUnitPrice: 1,
      })),
    });
    expect(result.tradeReceipt.fills).toHaveLength(count);
    expect(result.tradeReceipt.tradeCount).toBe(count * count);
    const sellers = new Map<string, number>();
    const buyers = new Map<string, number>();
    let tradeCount = 0;
    for (const trade of producerTrades(result.tradeReceipt)) {
      sellers.set(trade.sellerAccountId, (sellers.get(trade.sellerAccountId) ?? 0) + trade.amount);
      buyers.set(trade.buyerAccountId, (buyers.get(trade.buyerAccountId) ?? 0) + trade.amount);
      tradeCount++;
    }
    expect(tradeCount).toBe(result.tradeReceipt.tradeCount);
    for (const account of result.accounts) {
      if (account.id.startsWith("seller:"))
        expect(sellers.get(account.id)).toBeCloseTo(account.cash, 10);
      else expect(1 - buyers.get(account.id)!).toBeCloseTo(account.cash, 10);
    }
    expect(Buffer.byteLength(JSON.stringify(result.tradeReceipt))).toBeLessThan(150000);
  });

  it("honors a supplier contract price without duplicating public stock", () => {
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "seller", cash: 0 },
        { id: "contract-buyer", cash: 100 },
        { id: "public-buyer", cash: 100 },
      ],
      offers: [
        {
          id: "stock",
          accountId: "seller",
          commodity: "steel",
          book: "world",
          units: 10,
          unitPrice: 5,
        },
      ],
      orders: [
        {
          id: "a-public",
          accountId: "public-buyer",
          commodity: "steel",
          book: "world",
          units: 10,
          maximumUnitPrice: 5,
        },
        {
          id: "z-contract",
          accountId: "contract-buyer",
          commodity: "steel",
          book: "world",
          units: 6,
          maximumUnitPrice: 2,
          supplierOfferId: "stock",
          contractUnitPrice: 2,
        },
      ],
    });
    expect([...producerTrades(result.tradeReceipt)]).toMatchObject([
      { orderId: "z-contract", units: 6, unitPrice: 2, amount: 12 },
      { orderId: "a-public", units: 4, unitPrice: 5, amount: 20 },
    ]);
    expect(result.offers[0]).toMatchObject({ deliveredUnits: 10, revenue: 32 });
    expect(result.prices[0]).toMatchObject({ units: 10, value: 32, unitPrice: 3.2 });
  });

  it.each([0, 6])(
    "buys a supplier shortfall on the public book without double buying, contracted stock=%s",
    (contractedStock) => {
      const quantityGroup = { id: "steel-input", maximumUnits: 10 };
      const result = settleProducerMarket({
        turn: 1,
        accounts: [
          { id: "buyer", cash: 100 },
          { id: "contract-seller", cash: 0 },
          { id: "public-seller", cash: 0 },
        ],
        offers: [
          {
            id: "contract-stock",
            accountId: "contract-seller",
            commodity: "steel",
            book: "world",
            units: contractedStock,
            unitPrice: 5,
          },
          {
            id: "public-stock",
            accountId: "public-seller",
            commodity: "steel",
            book: "world",
            units: 10,
            unitPrice: 3,
          },
        ],
        orders: [
          {
            id: "reserved",
            accountId: "buyer",
            commodity: "steel",
            book: "world",
            units: 6,
            maximumUnitPrice: 2,
            supplierOfferId: "contract-stock",
            contractUnitPrice: 2,
            quantityGroup,
          },
          {
            id: "fallback",
            accountId: "buyer",
            commodity: "steel",
            book: "world",
            units: 10,
            maximumUnitPrice: 3,
            quantityGroup,
          },
        ],
      });
      expect(result.orders.reduce((sum, order) => sum + order.deliveredUnits, 0)).toBe(10);
      expect(result.orders.reduce((sum, order) => sum + order.cost, 0)).toBe(
        contractedStock * 2 + (10 - contractedStock) * 3
      );
    }
  );

  it("rejects an unnamed contract price or one above the buyer's limit", () => {
    const base = { turn: 1, accounts: [{ id: "buyer", cash: 10 }], offers: [] };
    const order = {
      id: "order",
      accountId: "buyer",
      commodity: "goods",
      book: "world",
      units: 1,
      maximumUnitPrice: 1,
    };
    expect(() =>
      settleProducerMarket({ ...base, orders: [{ ...order, contractUnitPrice: 0.5 }] })
    ).toThrow("named supplier");
    expect(() =>
      settleProducerMarket({
        ...base,
        orders: [{ ...order, supplierOfferId: "seller", contractUnitPrice: 2 }],
      })
    ).toThrow("buyer limit");
  });

  it("cannot finance circular purchases from anticipated sale proceeds", () => {
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "a", cash: 0 },
        { id: "b", cash: 0 },
      ],
      offers: [
        {
          id: "a-goods",
          accountId: "a",
          commodity: "goods",
          book: "world",
          units: 10,
          unitPrice: 1,
        },
        {
          id: "b-goods",
          accountId: "b",
          commodity: "other",
          book: "world",
          units: 10,
          unitPrice: 1,
        },
      ],
      orders: [
        {
          id: "a-order",
          accountId: "a",
          commodity: "other",
          book: "world",
          units: 10,
          maximumUnitPrice: 1,
        },
        {
          id: "b-order",
          accountId: "b",
          commodity: "goods",
          book: "world",
          units: 10,
          maximumUnitPrice: 1,
        },
      ],
    });
    expect([...producerTrades(result.tradeReceipt)]).toEqual([]);
    expect(result.prices).toEqual([]);
  });

  it("shares one opening cash budget across commodities and never charges an input twice", () => {
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "buyer", cash: 10 },
        { id: "seller", cash: 0 },
      ],
      offers: ["energy", "software"].map((commodity) => ({
        id: commodity,
        accountId: "seller",
        commodity,
        book: "world",
        units: 10,
        unitPrice: 1,
      })),
      orders: ["energy", "software"].map((commodity) => ({
        id: commodity,
        accountId: "buyer",
        commodity,
        book: "world",
        units: 10,
        maximumUnitPrice: 1,
      })),
    });
    expect(result.orders.reduce((n, o) => n + o.cost, 0)).toBe(10);
    expect(result.offers.reduce((n, o) => n + o.revenue, 0)).toBe(10);
    expect(result.accounts.reduce((n, a) => n + a.cash, 0)).toBe(10);
  });

  it("keeps local services and supplier reservations in their eligible books", () => {
    const result = settleProducerMarket({
      turn: 1,
      accounts: [
        { id: "buyer", cash: 10 },
        { id: "seller", cash: 0 },
      ],
      offers: [
        {
          id: "rent",
          accountId: "seller",
          commodity: "real_estate_services",
          book: "state:A",
          units: 10,
          unitPrice: 1,
        },
      ],
      orders: [
        {
          id: "remote",
          accountId: "buyer",
          commodity: "real_estate_services",
          book: "state:B",
          units: 10,
          maximumUnitPrice: 1,
        },
      ],
    });
    expect([...producerTrades(result.tradeReceipt)]).toEqual([]);
  });

  it("moves genuine own supply without moving cash or manufacturing a market price", () => {
    const result = settleProducerMarket({
      turn: 1,
      accounts: [{ id: "group", cash: 0 }],
      offers: [
        {
          id: "output",
          accountId: "group",
          commodity: "steel",
          book: "world",
          units: 4,
          unitPrice: 2,
        },
      ],
      orders: [
        {
          id: "input",
          accountId: "group",
          commodity: "steel",
          book: "world",
          units: 9,
          maximumUnitPrice: 2,
          supplierOfferId: "output",
        },
      ],
    });
    expect([...producerTrades(result.tradeReceipt)][0]).toMatchObject({
      kind: "internalTransfer",
      units: 4,
      unitPrice: 0,
      amount: 0,
    });
    expect(result.offers[0].revenue).toBe(0);
    expect(result.orders[0].cost).toBe(0);
    expect(result.accounts[0].cash).toBe(0);
    expect(result.prices).toEqual([]);
  });

  it("rejects non-finite, duplicated and unbacked participant inputs", () => {
    expect(() =>
      settleProducerMarket({
        turn: 0,
        accounts: [{ id: "a", cash: Infinity }],
        offers: [],
        orders: [],
      })
    ).toThrow();
    expect(() =>
      settleProducerMarket({
        turn: 0,
        accounts: [
          { id: "a", cash: 1 },
          { id: "a", cash: 1 },
        ],
        offers: [],
        orders: [],
      })
    ).toThrow();
    expect(() =>
      settleProducerMarket({
        turn: 0,
        accounts: [],
        offers: [
          {
            id: "x",
            accountId: "missing",
            commodity: "goods",
            book: "world",
            units: 1,
            unitPrice: 1,
          },
        ],
        orders: [],
      })
    ).toThrow();
  });
});

describe("quote policies", () => {
  const basis = {
    referenceUnitPrice: 10,
    variableUnitCost: 4,
    fixedCost: 200,
    offeredUnits: 100,
    demand: [{ units: 200, maximumUnitPrice: 20 }],
    competitors: [{ units: 200, unitPrice: 10 }],
  };

  it("models the premium-price cliff without a catastrophic aggregate glut", () => {
    expect(quoteProducer({ ...basis, policy: { kind: "manual", unitPrice: 12 } })).toMatchObject({
      expectedSoldUnits: 0,
      expectedProfit: -600,
    });
    expect(quoteProducer({ ...basis, policy: { kind: "manual", unitPrice: 9 } })).toMatchObject({
      expectedSoldUnits: 100,
      expectedProfit: 300,
    });
  });

  it("prices payroll and inputs for finance and industry without a sector allowlist", () => {
    const quote = quoteProducer({ ...basis, policy: { kind: "costPlus", markup: 0.1 } });
    expect(quote.unitPrice).toBeCloseTo(6.6);
    expect(quote.breakEvenUnitPrice).toBe(6);
    expect(quote.expectedProfit).toBeCloseTo(60);
  });

  it("automatically chooses a demand-tested price rather than treating cost as guaranteed demand", () => {
    const quote = quoteProducer({ ...basis, policy: { kind: "automatic", targetMarkup: 0.1 } });
    expect(quote.unitPrice).toBeCloseTo(10);
    expect(quote.expectedSoldUnits).toBeCloseTo(200 / 3);
    expect(quote.expectedProfit).toBeCloseTo(2000 / 3 - 600);
  });

  it("matches an independent price-level oracle across heterogeneous books", () => {
    let state = 731;
    const next = (limit: number) => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state % limit;
    };
    for (let run = 0; run < 100; run++) {
      const demand = Array.from({ length: 20 }, () => ({
        units: next(100),
        maximumUnitPrice: next(21),
      }));
      const competitors = Array.from({ length: 20 }, () => ({
        units: next(100),
        unitPrice: next(21),
      }));
      const candidates = [
        ...new Set([
          10,
          6.6,
          ...demand.map((d) => d.maximumUnitPrice),
          ...competitors.map((c) => c.unitPrice),
        ]),
      ];
      const oracle = candidates
        .map((price) => {
          const wanted = demand
            .filter((d) => d.maximumUnitPrice >= price)
            .reduce((sum, d) => sum + d.units, 0);
          const cheaper = competitors
            .filter((c) => c.unitPrice < price)
            .reduce((sum, c) => sum + c.units, 0);
          const tied =
            100 +
            competitors.filter((c) => c.unitPrice === price).reduce((sum, c) => sum + c.units, 0);
          const sold = Math.min(100, (Math.max(0, wanted - cheaper) * 100) / tied);
          return { unitPrice: price, expectedSoldUnits: sold, expectedProfit: sold * price - 600 };
        })
        .sort((a, b) => b.expectedProfit - a.expectedProfit || a.unitPrice - b.unitPrice)[0];
      const quote = quoteProducer({
        ...basis,
        demand,
        competitors,
        policy: { kind: "automatic", targetMarkup: 0.1 },
      });
      expect(quote.unitPrice).toBeCloseTo(oracle.unitPrice, 10);
      expect(quote.expectedSoldUnits).toBeCloseTo(oracle.expectedSoldUnits, 10);
      expect(quote.expectedProfit).toBeCloseTo(oracle.expectedProfit, 10);
    }
  });

  it("does not report break-even when nothing can be produced", () => {
    expect(
      quoteProducer({ ...basis, offeredUnits: 0, policy: { kind: "automatic", targetMarkup: 0.1 } })
    ).toMatchObject({ breakEvenUnitPrice: null, expectedSoldUnits: 0, expectedProfit: -200 });
  });
});
