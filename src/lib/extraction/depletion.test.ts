import { describe, it, expect } from "vitest";
import type { StateResourceCapacity } from "@/lib/db/types/stateResourceCapacity";
import {
  DEPOSIT_RESERVE_TURNS,
  depositRemainingUnits,
  depletedCapacityPerTurn,
  depletedCapacityDoc,
  buildDepletionInc,
} from "./depletion";

function makeDoc(overrides: Partial<StateResourceCapacity> = {}): StateResourceCapacity {
  return {
    stateId: "US-TX",
    countryId: "US",
    resources: { oil: 100, coal: 50 },
    updatedAt: new Date(),
    ...overrides,
  } as StateResourceCapacity;
}

describe("deposit depletion", () => {
  it("treats a doc with no extraction history as a full deposit", () => {
    const doc = makeDoc();
    expect(depositRemainingUnits(doc, "oil")).toBe(100 * DEPOSIT_RESERVE_TURNS);
    // The per-turn ceiling is untouched — this is the pre-P3b world.
    expect(depletedCapacityPerTurn(doc, "oil")).toBe(100);
    expect(depletedCapacityDoc(doc).resources).toEqual({ oil: 100, coal: 50 });
  });

  it("only throttles the flow ceiling at the very end of the field's life", () => {
    const nearlySpent = makeDoc({
      extractedUnits: { oil: 100 * DEPOSIT_RESERVE_TURNS - 30 },
    });
    expect(depositRemainingUnits(nearlySpent, "oil")).toBe(30);
    expect(depletedCapacityPerTurn(nearlySpent, "oil")).toBe(30);

    const halfSpent = makeDoc({ extractedUnits: { oil: (100 * DEPOSIT_RESERVE_TURNS) / 2 } });
    expect(depletedCapacityPerTurn(halfSpent, "oil")).toBe(100);
  });

  it("shuts an exhausted deposit off without going negative", () => {
    const spent = makeDoc({ extractedUnits: { oil: 999 * DEPOSIT_RESERVE_TURNS } });
    expect(depositRemainingUnits(spent, "oil")).toBe(0);
    expect(depletedCapacityPerTurn(spent, "oil")).toBe(0);
    // Untouched resources in the same state are unaffected.
    expect(depletedCapacityPerTurn(spent, "coal")).toBe(50);
  });

  it("extends the field's life when prospecting raises the flow ceiling", () => {
    const extracted = 100 * DEPOSIT_RESERVE_TURNS - 30;
    const before = makeDoc({ extractedUnits: { oil: extracted } });
    // A survey doubles the per-turn ceiling; reserves are derived, so the
    // remaining life doubles with it — no second write anywhere.
    const after = makeDoc({ resources: { oil: 200 }, extractedUnits: { oil: extracted } });
    expect(depositRemainingUnits(before, "oil")).toBe(30);
    expect(depositRemainingUnits(after, "oil")).toBe(100 * DEPOSIT_RESERVE_TURNS + 30);
    expect(depletedCapacityPerTurn(after, "oil")).toBe(200);
  });

  it("builds a $inc payload only for resources actually produced", () => {
    expect(buildDepletionInc({ oil: 12.5, coal: 0 })).toEqual({ "extractedUnits.oil": 12.5 });
    expect(buildDepletionInc({})).toEqual({});
  });

  it("never mutates the doc it adjusts", () => {
    const doc = makeDoc({ extractedUnits: { oil: 999 * DEPOSIT_RESERVE_TURNS } });
    depletedCapacityDoc(doc);
    expect(doc.resources.oil).toBe(100);
  });
});
