import { describe, expect, it } from "vitest";
import { advanceProducerEconomy, type ProductionPlan } from "./production";

const plant = (changes: Partial<ProductionPlan> = {}): ProductionPlan => ({
  id: "plant",
  accountId: "corp",
  capacityUnits: 100,
  activeFraction: 1,
  outputMultiplier: 1,
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
  it("reports paid unit prices separately from internal site deliveries", () => {
    const energy = {
      commodity: "energy",
      book: "world",
      unitsPerOutput: 1,
      referenceUnitPrice: 3,
      policy: { kind: "manual" as const, unitPrice: 3 },
      storable: false,
    };
    const steel = {
      ...energy,
      commodity: "steel",
      referenceUnitPrice: 2,
      policy: { kind: "manual" as const, unitPrice: 2 },
      storable: true,
    };
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [
        plant({ id: "power", capacityUnits: 10, inputs: [], outputs: [energy] }),
        plant({
          id: "steel",
          capacityUnits: 10,
          inputs: [
            { commodity: "energy", book: "world", unitsPerOutput: 0.5, maximumUnitPrice: 3 },
          ],
          outputs: [steel],
        }),
      ],
      externalOrders: [
        {
          id: "energy-customer",
          accountId: "households",
          commodity: "energy",
          book: "world",
          units: 5,
          maximumUnitPrice: 3,
        },
        {
          id: "steel-customer",
          accountId: "households",
          commodity: "steel",
          book: "world",
          units: 10,
          maximumUnitPrice: 2,
        },
      ],
    });
    expect(result.producers.find((p) => p.id === "power")!.products[0]).toMatchObject({
      soldUnits: 5,
      deliveredUnits: 10,
      internalDeliveredUnits: 5,
      revenue: 15,
      realizedUnitPrice: 3,
    });
    expect(result.producers.find((p) => p.id === "steel")!.purchases).toBe(0);
  });
  it("can run a partial batch entirely from this site's purchased inputs", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [plant({ inputStock: [{ commodity: "energy", units: 100, value: 40 }] })],
    });
    expect(result.producers[0]).toMatchObject({
      producedUnits: 50,
      plannedUnits: 50,
      purchases: 0,
      inputsConsumed: 40,
      cashFlow: -30,
    });
  });

  it("cannot plan another site's production from privately retained inputs", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [
        plant({
          id: "owner",
          activeFraction: 0,
          inputStock: [{ commodity: "energy", units: 100, value: 40 }],
        }),
        plant({ id: "other" }),
      ],
    });
    expect(result.producers.find((p) => p.id === "other")!.plannedUnits).toBe(0);
    expect(result.producers.find((p) => p.id === "owner")!.inputStock[0]).toMatchObject({
      units: 100,
      value: 40,
    });
  });
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
      labourArrears: 20,
      otherOperatingArrears: 10,
      profit: -30,
      cashFlow: 0,
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

  it("preserves physical productivity improvements above nameplate and reports the actual unit price", () => {
    const result = advanceProducerEconomy({
      turn: 1,
      accounts,
      producers: [plant({ inputs: [], outputMultiplier: 1.25 })],
      externalOrders: [
        {
          id: "customer",
          accountId: "households",
          commodity: "financial_services",
          book: "world",
          units: 200,
          maximumUnitPrice: 3,
        },
      ],
    });
    expect(result.producers[0].producedUnits).toBe(125);
    expect(result.producers[0].products[0]).toMatchObject({
      producedUnits: 125,
      deliveredUnits: 125,
      askingUnitPrice: 3,
      realizedUnitPrice: 3,
      revenue: 375,
    });
  });

  it("keeps a productive supplier cycle alive when an earlier final buyer competes for its inputs", () => {
    const output = (commodity: string, unitPrice = 1) => ({
      commodity,
      book: "world",
      unitsPerOutput: 1,
      policy: { kind: "manual" as const, unitPrice },
      referenceUnitPrice: unitPrice,
      storable: true,
    });
    const input = (commodity: string, unitsPerOutput: number) => ({
      commodity,
      book: "world",
      unitsPerOutput,
      maximumUnitPrice: 1,
    });
    const common = { capacityUnits: 10, labourCost: 0, otherOperatingCost: 0 };
    const result = advanceProducerEconomy({
      turn: 1,
      accounts: [
        ...accounts.map((a) => (a.id === "supplier" ? { ...a, cash: 1000 } : a)),
        { id: "final", cash: 1000 },
      ],
      producers: [
        plant({
          ...common,
          id: "a-final",
          accountId: "final",
          inputs: [input("energy", 1), input("steel", 1)],
          outputs: [output("goods", 5)],
        }),
        plant({
          ...common,
          id: "power",
          inputs: [input("steel", 0.5)],
          outputs: [output("energy")],
        }),
        plant({
          ...common,
          id: "steel",
          accountId: "supplier",
          inputs: [input("energy", 0.5)],
          outputs: [output("steel")],
        }),
      ],
    });
    expect(result.producers.map((p) => p.producedUnits)).toEqual([5, 10, 10]);
    expect(result.accounts.reduce((sum, a) => sum + a.cash, 0)).toBe(4000);
  });
});
