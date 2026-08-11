import { describe, it, expect } from "vitest";
import { theaterReducer, type TheaterState } from "./useTheaterState";

function s(over: Partial<TheaterState> = {}): TheaterState {
  return { country: "US", cohesion: 85, sel: "afghan", committed: {}, pool: 1000, ...over };
}

describe("theaterReducer", () => {
  it("SET_COMMITTED clamps against the remaining pool", () => {
    const next = theaterReducer(s({ committed: { nicaragua: 400 } }), {
      type: "SET_COMMITTED",
      id: "afghan",
      v: 999,
    });
    expect(next.committed.afghan).toBe(600); // pool 1000 − 400 committed elsewhere
  });

  it("SET_COMMITTED floors at zero", () => {
    const next = theaterReducer(s(), { type: "SET_COMMITTED", id: "afghan", v: -50 });
    expect(next.committed.afghan).toBe(0);
  });

  it("COMMIT_ALL commits the remaining pool to a theater", () => {
    const next = theaterReducer(s({ committed: { nicaragua: 200 } }), {
      type: "COMMIT_ALL",
      id: "afghan",
    });
    expect(next.committed.afghan).toBe(800);
  });

  it("WITHDRAW zeroes a theater", () => {
    const next = theaterReducer(s({ committed: { afghan: 300 } }), {
      type: "WITHDRAW",
      id: "afghan",
    });
    expect(next.committed.afghan).toBe(0);
  });

  it("SET_COHESION clamps to [40, 100]", () => {
    expect(theaterReducer(s(), { type: "SET_COHESION", v: 999 }).cohesion).toBe(100);
    expect(theaterReducer(s(), { type: "SET_COHESION", v: 5 }).cohesion).toBe(40);
  });

  it("SELECT updates the selection only", () => {
    const next = theaterReducer(s(), { type: "SELECT", id: "ogaden" });
    expect(next.sel).toBe("ogaden");
    expect(next.committed).toEqual({});
  });
});
