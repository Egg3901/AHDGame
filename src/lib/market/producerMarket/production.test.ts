import { describe, expect, it } from "vitest";
import { advanceProducerEconomy, type ProductionPlan } from "./production";

const plant = (changes: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: "plant",
  accountId: "corp",
  capacityUnits: 100,
  activeFraction: 1,
  physicalFraction: 1,
  labourCost: 20,
  otherOperatingCost: 10,
  labourRecipientAccountId: "households",
  operatingRecipientAccountId: "services",
  inputs: [{ commodity: "energy", unitsPerOutput: 2, book: "world", maximumUnitPrice: 1 }],
  outputs: [
    {
      commodity: "financial_services",
      unitsPerOutput: 1,
      book: "world",
      policy: { kind: "manual", unitPrice: 3 },
      referenceUnitPrice: 3,
      storable: false,
    },
  ],
  inputStock: [],
  outputStock: [],
  ...changes,
});
const accounts = [
  { id: "corp", cash: 1000 },
  { id: "households", cash: 1000 },
  { id: "services", cash: 0 },
  { id: "supplier", cash: 0 },
];

describe("receipt-backed production", () => {
  it("cannot produce or sell output without delivered inputs", () => {
    const result = advanceProducerEconomy({ turn: 1, accounts, producers: [plant()] });
    expect(result.producers[0]).toMatchObject({
      producedUnits: 0,
      revenue: 0,
      purchases: 0,
      labourPaid: 20,
      otherOperatingPaid: 10,
      profit: -30,
      cashFlow: -30,
    });
    expect(result.accounts.reduce((n, a) => n + a.cash, 0)).toBe(2000);
  });

  it("buys only available inputs and produces only the supported recipe quantity", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [plant()],
      externalOffers: [
        {
          id: "power",
          accountId: "supplier",
          commodity: "energy",
          book: "world",
          units: 50,
          unitPrice: 1,
        },
      ],
    });
    expect(result.producers[0]).toMatchObject({
      producedUnits: 25,
      purchases: 50,
      inputsConsumed: 50,
      profit: -80,
      cashFlow: -80,
    });
    expect(result.producers[0].outputStock[0].units).toBe(0);
    expect(result.trades[0]).toMatchObject({ units: 50, amount: 50 });
  });

  it("does not charge already purchased inputs again when their reference price changes", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [plant({ inputStock: [{ commodity: "energy", units: 200, value: 80 }] })],
    });
    expect(result.producers[0]).toMatchObject({
      producedUnits: 100,
      purchases: 0,
      inputsConsumed: 80,
      profit: -110,
      cashFlow: -30,
    });
    expect(result.accounts.find((a) => a.id === "corp")!.cash).toBe(970);
  });

  it("offers only existing stock plus input-backed production and expires undelivered services", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [
        plant({
          inputStock: [{ commodity: "energy", units: 200, value: 100 }],
          outputStock: [{ commodity: "financial_services", book: "world", units: 50 }],
        }),
      ],
      externalOrders: [
        {
          id: "consumer",
          accountId: "households",
          commodity: "financial_services",
          book: "world",
          units: 20,
          maximumUnitPrice: 3,
        },
      ],
    });
    expect(result.producers[0]).toMatchObject({
      producedUnits: 100,
      offeredUnits: 150,
      deliveredUnits: 20,
      revenue: 60,
      purchases: 0,
      inputsConsumed: 100,
      profit: -70,
      cashFlow: 30,
    });
    expect(result.producers[0].outputStock[0].units).toBe(0);
    expect(result.prices[0]).toMatchObject({
      commodity: "financial_services",
      unitPrice: 3,
      units: 20,
    });
  });

  it("retains unsold physical stock and charges fixed bills despite full sales of a small run", () => {
    const p = plant({
      capacityUnits: 2,
      inputs: [],
      outputs: [
        {
          commodity: "financial_services",
          book: "world",
          unitsPerOutput: 1,
          policy: { kind: "manual", unitPrice: 3 },
          referenceUnitPrice: 3,
          storable: true,
        },
      ],
    });
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [p],
      externalOrders: [
        {
          id: "customer",
          accountId: "households",
          commodity: "financial_services",
          book: "world",
          units: 2,
          maximumUnitPrice: 3,
        },
      ],
    });
    expect(result.producers[0]).toMatchObject({ deliveredUnits: 2, revenue: 6, profit: -24 });
    expect(result.producers[0].outputStock[0].units).toBe(0);
  });

  it("does not pay wages or buy inputs from bank deposits or anticipated revenue", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts: accounts.map((a) => (a.id === "corp" ? { ...a, cash: 0 } : a)),
      producers: [plant({ inputStock: [{ commodity: "energy", units: 200, value: 100 }] })],
    });
    expect(result.producers[0]).toMatchObject({
      producedUnits: 0,
      labourPaid: 0,
      otherOperatingPaid: 0,
      operatingArrears: 30,
    });
    expect(result.producers[0].inputStock[0].units).toBe(200);
  });

  it("allocates one corporation fixed-bill funding proportionally across its sites", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts: accounts.map((a) => (a.id === "corp" ? { ...a, cash: 30 } : a)),
      producers: [plant({ id: "b", inputs: [] }), plant({ id: "a", inputs: [] })],
    });
    expect(result.producers.map((p) => p.producedUnits)).toEqual([50, 50]);
    expect(result.producers.map((p) => p.operatingArrears)).toEqual([15, 15]);
    expect(result.accounts.find((a) => a.id === "corp")!.cash).toBe(0);
  });

  it("is independent of producer input array ordering", () => {
    const a = plant({
      id: "a",
      inputs: [],
      outputs: [
        {
          commodity: "goods",
          book: "world",
          unitsPerOutput: 1,
          policy: { kind: "automatic", targetMarkup: 0.1 },
          referenceUnitPrice: 3,
          storable: true,
        },
      ],
      outputStock: [{ commodity: "goods", book: "world", units: 20 }],
    });
    const b = plant({
      id: "b",
      inputs: [],
      outputs: [
        {
          commodity: "goods",
          book: "world",
          unitsPerOutput: 1,
          policy: { kind: "manual", unitPrice: 2 },
          referenceUnitPrice: 3,
          storable: true,
        },
      ],
      outputStock: [{ commodity: "goods", book: "world", units: 20 }],
    });
    const args = {
      turn: 1,
      accounts,
      externalOrders: [
        {
          id: "customer",
          accountId: "households",
          commodity: "goods",
          book: "world",
          units: 30,
          maximumUnitPrice: 3,
        },
      ],
    };
    expect(advanceProducerEconomy({ ...args, producers: [a, b] })).toEqual(
      advanceProducerEconomy({ ...args, producers: [b, a] })
    );
  });

  it("settles productive input cycles jointly without selling unsupported output", () => {
    const a = plant({
      id: "power",
      accountId: "corp",
      capacityUnits: 10,
      labourCost: 0,
      otherOperatingCost: 0,
      inputs: [{ commodity: "steel", book: "world", unitsPerOutput: 0.5, maximumUnitPrice: 1 }],
      outputs: [
        {
          commodity: "energy",
          book: "world",
          unitsPerOutput: 1,
          policy: { kind: "manual", unitPrice: 1 },
          referenceUnitPrice: 1,
          storable: true,
        },
      ],
    });
    const b = plant({
      id: "steel",
      accountId: "supplier",
      capacityUnits: 10,
      labourCost: 0,
      otherOperatingCost: 0,
      inputs: [{ commodity: "energy", book: "world", unitsPerOutput: 0.5, maximumUnitPrice: 1 }],
      outputs: [
        {
          commodity: "steel",
          book: "world",
          unitsPerOutput: 1,
          policy: { kind: "manual", unitPrice: 1 },
          referenceUnitPrice: 1,
          storable: true,
        },
      ],
    });
    const funded = accounts.map((a) => (a.id === "supplier" ? { ...a, cash: 100 } : a));
    const result = advanceProducerEconomy({ turn: 1, accounts: funded, producers: [a, b] });
    expect(result.producers.map((p) => p.producedUnits)).toEqual([10, 10]);
    expect(result.trades.reduce((n, t) => n + t.units, 0)).toBe(10);
    expect(result.producers.map((p) => p.outputStock[0].units)).toEqual([5, 5]);
    const empty = funded.map((a) => (["corp", "supplier"].includes(a.id) ? { ...a, cash: 0 } : a));
    const unfunded = advanceProducerEconomy({ turn: 1, accounts: empty, producers: [a, b] });
    expect(unfunded.producers.map((p) => p.producedUnits)).toEqual([0, 0]);
    expect(unfunded.trades).toEqual([]);
  });
});
