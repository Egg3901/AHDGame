import { describe, expect, it } from "vitest";
import { quoteProducer, settleProducerMarket } from "./rules";

describe("one funded producer market", () => {
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
    expect(result.trades).toEqual([
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
    expect(result.trades).toEqual([]);
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
    expect(result.trades).toEqual([]);
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
    expect(result.trades[0]).toMatchObject({
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

  it("does not report break-even when nothing can be produced", () => {
    expect(
      quoteProducer({ ...basis, offeredUnits: 0, policy: { kind: "automatic", targetMarkup: 0.1 } })
    ).toMatchObject({ breakEvenUnitPrice: null, expectedSoldUnits: 0, expectedProfit: -200 });
  });
});
