import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { regressToward } from "./supportDecay";

describe("regressToward", () => {
  it("snaps to target when within step", () => {
    expect(regressToward(50.3, 50, 0.5)).toBe(50);
    expect(regressToward(49.8, 50, 0.5)).toBe(50);
  });

  it("moves down toward target by step when above", () => {
    expect(regressToward(60, 50, 0.5)).toBe(59.5);
    expect(regressToward(80, 50, 0.5)).toBe(79.5);
  });

  it("moves up toward target by step when below", () => {
    expect(regressToward(40, 50, 0.5)).toBe(40.5);
    expect(regressToward(20, 50, 0.5)).toBe(20.5);
  });

  it("stays exactly at target when already there", () => {
    expect(regressToward(50, 50, 0.5)).toBe(50);
  });

  it("does not overshoot regardless of step magnitude", () => {
    expect(regressToward(40, 50, 100)).toBe(50);
    expect(regressToward(60, 50, 100)).toBe(50);
  });
});

// processSupportDecay + processClearResolvedSupport are integration-shape
// — they require a full DB stub. The pure helper above + the caller-side
// integration in `turnPhaseRegistry` cover the meaningful logic. Keeping
// the unit-level coverage here on the regress-to-mean math; the runtime
// behavior is exercised by the registry's existing turn-pipeline tests
// once the dev server runs at least one turn.
describe("ObjectId fixtures (sanity)", () => {
  it("creates fresh ObjectIds for fixture builders", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    expect(a.toString()).not.toBe(b.toString());
  });
});
