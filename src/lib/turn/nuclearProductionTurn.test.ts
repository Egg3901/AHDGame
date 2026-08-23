import { describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { applyNuclearProduction } from "./nuclearProductionTurn";

interface World {
  program: {
    _id: string;
    adopted: Record<string, number>;
    warheads: number;
    productionRate: number;
  } | null;
  appropriation: { balance: number; encumbered?: number };
  programWrites: Record<string, unknown>[];
}

/**
 * Mirrors the defenceRefitTurn test's stub-db style: emulate only the filters
 * the module actually issues. The federalBudget stub honours the $expr guard
 * `debitAppropriation` uses (balance minus encumbrance must cover the debit),
 * so a starved pot refuses the spend exactly like the real collection.
 */
function stubDb(w: World): Db {
  return {
    collection: (name: string) => {
      if (name === "nuclearPrograms") {
        return {
          findOne: async () => w.program,
          updateOne: async (_f: unknown, u: { $set: Record<string, unknown> }) => {
            w.programWrites.push(u.$set);
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      if (name === "federalBudget") {
        return {
          findOne: async () => ({
            countryId: "US",
            defenseAppropriation: {
              balance: w.appropriation.balance,
              encumbered: w.appropriation.encumbered ?? 0,
              accruedThroughTurn: 0,
              arrearsRatio: 0,
            },
          }),
          updateOne: async (f: Record<string, unknown>, u: Record<string, unknown>) => {
            const inc = (u.$inc ?? {}) as Record<string, number>;
            const delta = inc["defenseAppropriation.balance"] ?? 0;
            if (f.$expr) {
              const available = w.appropriation.balance - (w.appropriation.encumbered ?? 0);
              if (available < -delta) return { matchedCount: 0, modifiedCount: 0 };
            }
            w.appropriation.balance += delta;
            return { matchedCount: 1, modifiedCount: 1 };
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
}

const program = (over: Partial<NonNullable<World["program"]>> = {}) => ({
  _id: "US",
  // Fission tier: cap 2 warheads/turn at 800 apiece.
  adopted: { "device-fission": 10 },
  warheads: 3,
  productionRate: 2,
  ...over,
});

const FLAGS = { coldWarEnabled: true, defenceProcurementPaused: false };

describe("applyNuclearProduction", () => {
  it("builds the ordered warheads and draws the cost from the appropriation", async () => {
    const w: World = { program: program(), appropriation: { balance: 10_000 }, programWrites: [] };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 2, spent: 1_600 });
    expect(w.appropriation.balance).toBe(8_400);
    expect(w.programWrites[0]).toMatchObject({ warheads: 5, productionRate: 2 });
  });

  it("does nothing while the Cold War subsystem is off", async () => {
    const w: World = { program: program(), appropriation: { balance: 10_000 }, programWrites: [] };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, {
      ...FLAGS,
      coldWarEnabled: false,
    });
    expect(r).toEqual({ warheadsBuilt: 0, spent: 0 });
    expect(w.appropriation.balance).toBe(10_000);
    expect(w.programWrites).toHaveLength(0);
  });

  // The stockpile is procurement by another name; the kill switch must cover it.
  it("does nothing while defence procurement is paused", async () => {
    const w: World = { program: program(), appropriation: { balance: 10_000 }, programWrites: [] };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, {
      ...FLAGS,
      defenceProcurementPaused: true,
    });
    expect(r).toEqual({ warheadsBuilt: 0, spent: 0 });
    expect(w.programWrites).toHaveLength(0);
  });

  it("builds fewer warheads than ordered when the budget only covers some", async () => {
    const w: World = { program: program(), appropriation: { balance: 900 }, programWrites: [] };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 1, spent: 800 });
    expect(w.appropriation.balance).toBe(100);
    expect(w.programWrites[0]).toMatchObject({ warheads: 4 });
  });

  it("builds nothing at all from a starved budget, without touching the pot", async () => {
    const w: World = { program: program(), appropriation: { balance: 500 }, programWrites: [] };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 0, spent: 0 });
    expect(w.appropriation.balance).toBe(500);
    expect(w.programWrites).toHaveLength(0);
  });

  // Encumbered money belongs to live contracts; production must not spend it.
  it("sizes the build against the uncommitted balance, not the raw one", async () => {
    const w: World = {
      program: program(),
      appropriation: { balance: 1_700, encumbered: 900 },
      programWrites: [],
    };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 1, spent: 800 });
  });

  it("does nothing when the ordered rate is zero", async () => {
    const w: World = {
      program: program({ productionRate: 0 }),
      appropriation: { balance: 10_000 },
      programWrites: [],
    };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 0, spent: 0 });
  });

  it("does nothing for a country with no adopted device node", async () => {
    const w: World = {
      program: program({ adopted: { "delivery-bombers": 4 } }),
      appropriation: { balance: 10_000 },
      programWrites: [],
    };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 0, spent: 0 });
  });

  it("does nothing for a country that never opened a programme", async () => {
    const w: World = { program: null, appropriation: { balance: 10_000 }, programWrites: [] };
    const r = await applyNuclearProduction(stubDb(w), "US", 1953, 42, FLAGS);
    expect(r).toEqual({ warheadsBuilt: 0, spent: 0 });
    expect(w.programWrites).toHaveLength(0);
  });
});
