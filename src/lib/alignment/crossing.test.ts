import { describe, expect, it } from "vitest";
import { customAlignmentPoleId, polesForYear } from "@/lib/constants/alignmentEras";
import { normalizeShares } from "./normalize";
import { applyEraCrossing } from "./crossing";

const cold = normalizeShares({ WEST: 60, EAST: 20 }, polesForYear(1953));

describe("applyEraCrossing", () => {
  it("does nothing inside the same era", () => {
    const r = applyEraCrossing({ shares: cold, storedEraKey: "cold-war", year: 1979 });
    expect(r.crossed).toBe(false);
    expect(r.eraKey).toBe("cold-war");
    expect(r.shares).toEqual(cold);
  });

  it("re-projects West to Washington and East to Moscow", () => {
    const r = applyEraCrossing({ shares: cold, storedEraKey: "cold-war", year: 1991 });
    expect(r.crossed).toBe(true);
    expect(r.eraKey).toBe("post-cold-war");
    expect(r.shares.shares.WASHINGTON).toBe(60);
    expect(r.shares.shares.MOSCOW).toBe(20);
    expect(r.shares.shares.WEST).toBeUndefined();
    expect(r.shares.shares.EAST).toBeUndefined();
  });

  it("starts Beijing at zero — it has to be earned", () => {
    const r = applyEraCrossing({ shares: cold, storedEraKey: "cold-war", year: 1991 });
    expect(r.shares.shares.BEIJING).toBe(0);
  });

  it("carries the uncommitted remainder across unchanged", () => {
    const r = applyEraCrossing({ shares: cold, storedEraKey: "cold-war", year: 1991 });
    expect(r.shares.nonAligned).toBe(cold.nonAligned);
  });

  it("is idempotent — crossing twice equals crossing once", () => {
    const once = applyEraCrossing({ shares: cold, storedEraKey: "cold-war", year: 1991 });
    const twice = applyEraCrossing({
      shares: once.shares,
      storedEraKey: once.eraKey,
      year: 1991,
    });
    expect(twice.crossed).toBe(false);
    expect(twice.shares).toEqual(once.shares);
  });

  it("keeps the invariant across the crossing", () => {
    const r = applyEraCrossing({ shares: cold, storedEraKey: "cold-war", year: 1991 });
    const sum =
      (Object.values(r.shares.shares) as number[]).reduce((a, b) => a + b, 0) + r.shares.nonAligned;
    expect(sum).toBe(100);
  });

  it("preserves a player-founded pole while built-in poles cross eras", () => {
    const custom = customAlignmentPoleId("andes-pact");
    const shares = normalizeShares({ WEST: 30, EAST: 10, [custom]: 50 }, ["WEST", "EAST", custom]);
    const poles = [...polesForYear(1991), custom];
    const result = applyEraCrossing({
      shares,
      storedEraKey: "cold-war",
      year: 1991,
      poles,
    });

    expect(result.shares.shares.WASHINGTON).toBe(30);
    expect(result.shares.shares.MOSCOW).toBe(10);
    expect(result.shares.shares[custom]).toBe(50);
  });
});
