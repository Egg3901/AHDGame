import { describe, it, expect } from "vitest";
import { resolvedSeatsEstimate } from "./resolvedSeatsEstimate";

/**
 * Ticket #1277. The detail page recomputed the allocation on every load, so a
 * finished election rendered a different result whenever an input to the
 * allocator drifted. The authoritative allocation is already persisted at
 * resolution; once finalized it is the only thing the page may show.
 */
describe("resolvedSeatsEstimate", () => {
  const persisted = { a: 7, b: 4, c: 4 };
  const computed = { a: 16, b: 10, c: 9 };

  it("serves the persisted allocation once the tally is finalized", () => {
    expect(resolvedSeatsEstimate({ finalized: true, seatsEstimate: persisted }, computed)).toEqual(
      persisted
    );
  });

  it("serves the live projection while the count is still running", () => {
    // `accumulateVoteTurn` rewrites the root `seatsEstimate` every turn, so an
    // unfinalized value is a mid-count projection and must not be preferred.
    expect(resolvedSeatsEstimate({ finalized: false, seatsEstimate: persisted }, computed)).toEqual(
      computed
    );
  });

  it("falls back to the projection when a finalized tally carries no allocation", () => {
    expect(resolvedSeatsEstimate({ finalized: true, seatsEstimate: {} }, computed)).toEqual(
      computed
    );
    expect(resolvedSeatsEstimate({ finalized: true }, computed)).toEqual(computed);
  });

  it("falls back to the projection when there is no tally at all", () => {
    expect(resolvedSeatsEstimate(null, computed)).toEqual(computed);
    expect(resolvedSeatsEstimate(undefined, computed)).toEqual(computed);
  });

  it("serves the persisted allocation even when the projection is null", () => {
    // Single-seat and non-multi-seat races project null; a finalized
    // multi-seat allocation must still win.
    expect(resolvedSeatsEstimate({ finalized: true, seatsEstimate: persisted }, null)).toEqual(
      persisted
    );
  });

  it("returns null when neither source has anything", () => {
    expect(resolvedSeatsEstimate(null, null)).toBeNull();
    expect(resolvedSeatsEstimate({ finalized: true, seatsEstimate: {} }, null)).toBeNull();
  });

  it("does not alias the persisted object", () => {
    const tally = { finalized: true, seatsEstimate: { a: 1 } };
    const out = resolvedSeatsEstimate(tally, null)!;
    out.a = 99;
    expect(tally.seatsEstimate.a).toBe(1);
  });
});
