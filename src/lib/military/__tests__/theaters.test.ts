import { describe, it, expect } from "vitest";
import {
  supplyMult,
  defconFor,
  RESERVE_THEATER_ID,
  isAtConflict,
  postureFloorFor,
} from "../theaters";

// The 4 static theaters + their bloc/supply/effective-CP helpers are retired —
// conflicts are dynamic now (see the `conflicts` collection + createConflict). The bloc
// lookup has left too: it is read from live organisation membership now, and is covered
// by `bloc.test.ts`. What remains here is the cohesion→supply curve, DEFCON, and the
// reserve/posture-floor invariants that survive the dynamic-conflict move.

describe("war-footing math", () => {
  it("supplyMult scales with cohesion", () => {
    expect(supplyMult(100)).toBe(1);
    expect(supplyMult(85)).toBeCloseTo(0.93, 5);
    expect(supplyMult(40)).toBeCloseTo(0.7, 5);
  });
  it("maps cohesion to DEFCON", () => {
    expect(defconFor(90).level).toBe(2);
    expect(defconFor(70).level).toBe(3);
    expect(defconFor(50).level).toBe(4);
  });
});

describe("posture floor (units at a conflict)", () => {
  it("reserve is the homeland location", () => {
    expect(RESERVE_THEATER_ID).toBe("reserve");
    expect(isAtConflict("reserve")).toBe(false);
  });
  it("isAtConflict is true for any non-reserve location", () => {
    expect(isAtConflict("some-conflict-id")).toBe(true);
  });
  it("floors Garrison up to Standard at a conflict, leaves it alone in reserve", () => {
    expect(postureFloorFor("some-conflict-id", "garrison")).toBe("standard");
    expect(postureFloorFor("reserve", "garrison")).toBe("garrison");
  });
  it("never forces down: standard/forward/alert are untouched at a conflict", () => {
    expect(postureFloorFor("some-conflict-id", "standard")).toBe("standard");
    expect(postureFloorFor("some-conflict-id", "forward")).toBe("forward");
    expect(postureFloorFor("some-conflict-id", "alert")).toBe("alert");
  });
});
