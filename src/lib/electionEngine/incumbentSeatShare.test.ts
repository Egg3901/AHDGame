import { describe, expect, it } from "vitest";
import { computeSeatShareFromTally } from "./incumbentSeatShare";

describe("computeSeatShareFromTally", () => {
  it("returns empty Map for zero total votes", () => {
    const out = computeSeatShareFromTally({}, {});
    expect(out.size).toBe(0);
  });

  it("returns empty Map when every vote count is zero", () => {
    const out = computeSeatShareFromTally({ c1: 0, c2: 0 }, { c1: "dem", c2: "rep" });
    expect(out.size).toBe(0);
  });

  it("single-seat single-party prior maps to 1.0 for that party", () => {
    const out = computeSeatShareFromTally({ c1: 50_000 }, { c1: "dem" });
    expect(out.get("dem")).toBeCloseTo(1.0);
    expect(out.size).toBe(1);
  });

  it("single-seat contested prior maps proportional to vote share", () => {
    const out = computeSeatShareFromTally({ c1: 55_000, c2: 45_000 }, { c1: "dem", c2: "rep" });
    expect(out.get("dem")).toBeCloseTo(0.55);
    expect(out.get("rep")).toBeCloseTo(0.45);
  });

  it("multi-candidate-per-party sums candidates within a party", () => {
    // US House CA — multi-seat-from-vote-share; multiple Dem candidates,
    // multiple Rep candidates; their votes pool to party totals.
    const out = computeSeatShareFromTally(
      {
        d1: 30_000,
        d2: 30_000, // Dem total 60,000
        r1: 25_000,
        r2: 5_000, // Rep total 30,000
        g1: 10_000, // Grn total 10,000
      },
      {
        d1: "dem",
        d2: "dem",
        r1: "rep",
        r2: "rep",
        g1: "grn",
      }
    );
    expect(out.get("dem")).toBeCloseTo(0.6);
    expect(out.get("rep")).toBeCloseTo(0.3);
    expect(out.get("grn")).toBeCloseTo(0.1);
    // Shares sum to 1.0 (modulo float rounding).
    const sum = [...out.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0);
  });

  it("ignores candidates with missing party affiliation defensively", () => {
    const out = computeSeatShareFromTally(
      { c1: 50_000, ghost: 50_000 },
      { c1: "dem" } // ghost has no entry
    );
    // ghost's votes are excluded from both party-bucket and the
    // grand-total denominator → dem ends at 100% of accounted votes.
    expect(out.get("dem")).toBeCloseTo(1.0);
  });

  it("ignores negative or non-finite vote counts defensively", () => {
    const out = computeSeatShareFromTally(
      { c1: 50_000, c2: -100, c3: NaN, c4: Infinity },
      { c1: "dem", c2: "rep", c3: "grn", c4: "ind" }
    );
    expect(out.get("dem")).toBeCloseTo(1.0);
    expect(out.has("rep")).toBe(false);
    expect(out.has("grn")).toBe(false);
    expect(out.has("ind")).toBe(false);
  });
});
