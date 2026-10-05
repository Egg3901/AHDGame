import { describe, expect, it } from "vitest";
import { allocatePaidAuthority } from "./paidAuthority";

describe("paid reset treasury authority", () => {
  it("preserves the paid pool and never exceeds a claimant's due", () => {
    const claims = [
      { id: "US:health", due: 10 },
      { id: "US:education", due: 5 },
      { id: "US:continuity", due: 5 },
    ];
    const split = allocatePaidAuthority(13, claims);
    expect(Object.values(split).reduce((sum, value) => sum + value, 0)).toBe(13);
    expect(split).toEqual({ "US:health": 7, "US:education": 3, "US:continuity": 3 });
    for (const claim of claims) expect(split[claim.id]).toBeLessThanOrEqual(claim.due);
  });

  it("uses deterministic residual order independent of input ordering", () => {
    const claims = [
      { id: "b", due: 1 },
      { id: "a", due: 1 },
      { id: "c", due: 1 },
    ];
    expect(allocatePaidAuthority(2, claims)).toEqual({ a: 1, b: 1, c: 0 });
    expect(allocatePaidAuthority(2, [...claims].reverse())).toEqual({ a: 1, b: 1, c: 0 });
  });

  it("keeps yen-sized whole-unit claims exact", () => {
    const claims = [
      { id: "JP:a", due: 2_900_000_000_000 },
      { id: "JP:b", due: 1_300_000_000_000 },
      { id: "JP:c", due: 2_500_000_000_000 },
    ];
    const split = allocatePaidAuthority(4_200_000_000_001, claims);
    expect(Object.values(split).reduce((sum, value) => sum + value, 0)).toBe(4_200_000_000_001);
    for (const claim of claims) expect(split[claim.id]).toBeLessThanOrEqual(claim.due);
  });

  it("rejects excess payment, duplicate ids, and unsafe amounts", () => {
    expect(() => allocatePaidAuthority(2, [{ id: "a", due: 1 }])).toThrow(/exceeds/);
    expect(() =>
      allocatePaidAuthority(0, [
        { id: "a", due: 1 },
        { id: "a", due: 1 },
      ])
    ).toThrow(/roster/);
    expect(() => allocatePaidAuthority(Number.MAX_SAFE_INTEGER + 1, [])).toThrow(/safe integer/);
  });
});
