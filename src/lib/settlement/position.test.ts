import { describe, expect, it } from "vitest";
import type { SettlementInstitutionState } from "@/lib/db/types/settlementCrisis";
import { HUNDREDTHS, SETTLEMENT_INSTITUTIONS } from "@/lib/constants/settlementCrisis";
import { applyToInstitution, clampPosition, recomputePosition, toPoints } from "./position";

function openingState(): SettlementInstitutionState[] {
  return SETTLEMENT_INSTITUTIONS.map((i) => ({
    id: i.id,
    weight: i.weight,
    position: i.opening,
    lastPlay: null,
    lastDrift: 0,
  }));
}

describe("recomputePosition", () => {
  it("reproduces the authored opening index of 38.2", () => {
    expect(recomputePosition(openingState())).toBe(3820);
  });

  it("weights institutions rather than averaging them flat", () => {
    const flat = openingState().map((s) => ({ ...s, weight: 1 }));
    // Flat mean of 43/37/61/19 is 40; the weighted mean is 38.2.
    expect(recomputePosition(flat)).toBe(4000);
    expect(recomputePosition(openingState())).toBe(3820);
  });

  it("returns an integer on the hundredths grid for any input", () => {
    const odd = openingState().map((s, n) => ({ ...s, position: 1234 + n * 777 }));
    const result = recomputePosition(odd);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("moves the index by exactly delta when every institution moves by delta", () => {
    // This is what makes a settlement-level play land at its stated value.
    const before = recomputePosition(openingState());
    const after = recomputePosition(
      openingState().map((s) => ({ ...s, position: s.position + 500 }))
    );
    expect(after - before).toBe(500);
  });

  it("returns zero for an empty institution list rather than dividing by zero", () => {
    expect(recomputePosition([])).toBe(0);
  });
});

describe("clampPosition", () => {
  it("holds values inside the grid", () => {
    expect(clampPosition(-1)).toBe(0);
    expect(clampPosition(10_001)).toBe(10_000);
    expect(clampPosition(4300)).toBe(4300);
  });

  it("rounds fractional input onto the grid", () => {
    expect(clampPosition(4300.6)).toBe(4301);
  });
});

describe("applyToInstitution", () => {
  it("adds a signed delta and clamps", () => {
    const [inst] = openingState();
    expect(applyToInstitution(inst, 200).position).toBe(inst.position + 200);
    expect(applyToInstitution(inst, -1_000_000).position).toBe(0);
    expect(applyToInstitution(inst, 1_000_000).position).toBe(10_000);
  });

  it("does not mutate its input", () => {
    const [inst] = openingState();
    const before = inst.position;
    applyToInstitution(inst, 500);
    expect(inst.position).toBe(before);
  });
});

describe("toPoints", () => {
  it("converts the storage grid to display points", () => {
    expect(toPoints(3820)).toBe(38.2);
    expect(toPoints(10_000)).toBe(100);
  });

  it("agrees with the HUNDREDTHS constant", () => {
    expect(toPoints(HUNDREDTHS)).toBe(1);
  });
});
