import { describe, expect, it } from "vitest";
import { hashToUint32, pickWeightedIndex, seededCooldownTurns, seededRoll } from "./rng";

describe("event substrate rng", () => {
  it("seededRoll returns stable values for the same inputs", () => {
    const a = seededRoll("char-1", 42, "pree.lotteryWin", "outcome");
    const b = seededRoll("char-1", 42, "pree.lotteryWin", "outcome");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(1);
    expect(a).toBeLessThanOrEqual(100);
  });

  it("seededRoll differs when salt changes", () => {
    const offer = seededRoll("char-1", 42, "pree.lotteryWin", "offer");
    const outcome = seededRoll("char-1", 42, "pree.lotteryWin", "outcome");
    expect(offer).not.toBe(outcome);
  });

  it("hashToUint32 is deterministic", () => {
    expect(hashToUint32("test-seed")).toBe(hashToUint32("test-seed"));
  });

  it("pickWeightedIndex selects by cumulative weight", () => {
    const items = [{ weight: 1 }, { weight: 3 }];
    expect(pickWeightedIndex(items, 1)).toBe(0);
    expect(pickWeightedIndex(items, 100)).toBe(1);
  });

  it("seededCooldownTurns stays within bounds", () => {
    const turns = seededCooldownTurns("char-1", 50, 10, 20);
    expect(turns).toBeGreaterThanOrEqual(10);
    expect(turns).toBeLessThanOrEqual(20);
  });
});
