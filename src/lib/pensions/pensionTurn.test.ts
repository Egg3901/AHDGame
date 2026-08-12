import { describe, it, expect } from "vitest";
import { coveredWageBill, coveredWageBillPerTurn } from "./pensionTurn";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";

describe("coveredWageBill", () => {
  it("sums the labour cost of the covered sectors", () => {
    expect(coveredWageBill([{ laborCost: 100 }, { laborCost: 250 }])).toBe(350);
  });

  it("treats an UNWRITTEN labour cost as zero, not as a guess", () => {
    // `laborCost` is absent whenever the labour system is off. Reading it as
    // anything other than zero would charge an employer for workers the economy
    // is not modelling.
    expect(coveredWageBill([{ laborCost: undefined }, { laborCost: 100 }])).toBe(100);
    expect(coveredWageBill([{}, {}])).toBe(0);
  });

  it("ignores a malformed or negative figure rather than crediting the employer", () => {
    expect(coveredWageBill([{ laborCost: Number.NaN }, { laborCost: -50 }, { laborCost: 10 }])).toBe(
      10
    );
  });

  it("is zero for an agreement covering nothing", () => {
    expect(coveredWageBill([])).toBe(0);
  });
});

describe("coveredWageBillPerTurn", () => {
  it("divides the stored DAILY labour cost down to the turn this pass runs on", () => {
    // `sectorTurn.ts` persists `laborCost` as the per-turn cost times
    // TURNS_PER_DAY. Charging the stored figure once per turn billed every
    // employer 24 times the bargained rate.
    expect(coveredWageBillPerTurn([{ laborCost: 2400 }])).toBe(2400 / TURNS_PER_DAY);
    expect(coveredWageBillPerTurn([{ laborCost: 240 }, { laborCost: 240 }])).toBe(
      480 / TURNS_PER_DAY
    );
  });

  it("is zero when nothing measurable is covered", () => {
    expect(coveredWageBillPerTurn([])).toBe(0);
    expect(coveredWageBillPerTurn([{ laborCost: undefined }])).toBe(0);
  });
});
