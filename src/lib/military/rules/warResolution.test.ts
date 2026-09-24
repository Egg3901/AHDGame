import { describe, expect, it } from "vitest";
import { eligiblePoleVictor, MIN_NON_PROXY_WAR_TURNS, sideAtPole } from "./warResolution";

const candidate = (over: Record<string, unknown> = {}) => ({
  type: "interstate" as const,
  status: "active" as const,
  startTurn: 100,
  currentTurn: 100 + MIN_NON_PROXY_WAR_TURNS,
  control: 100,
  poleSide: "B" as const,
  poleSinceTurn: 110,
  ...over,
});

describe("sideAtPole", () => {
  it("recognizes only complete control", () => {
    expect(sideAtPole(0)).toBe("A");
    expect(sideAtPole(100)).toBe("B");
    expect(sideAtPole(99)).toBeNull();
  });
});

describe("eligiblePoleVictor", () => {
  it("requires a full 24 turns", () => {
    expect(
      eligiblePoleVictor(candidate({ currentTurn: 100 + MIN_NON_PROXY_WAR_TURNS - 1 }))
    ).toBeNull();
    expect(eligiblePoleVictor(candidate())).toBe("B");
  });

  it("does not treat the defender's unstamped starting pole as victory", () => {
    expect(
      eligiblePoleVictor(candidate({ poleSide: undefined, poleSinceTurn: undefined }))
    ).toBeNull();
  });

  it("requires the stamp to agree with current territorial control", () => {
    expect(eligiblePoleVictor(candidate({ control: 99 }))).toBeNull();
    expect(eligiblePoleVictor(candidate({ poleSide: "A" }))).toBeNull();
  });

  it("accepts either side after a stamped arrival at a pole", () => {
    expect(eligiblePoleVictor(candidate({ control: 0, poleSide: "A" }))).toBe("A");
    expect(eligiblePoleVictor(candidate())).toBe("B");
  });

  it("leaves proxy wars to their separate hold rule", () => {
    expect(eligiblePoleVictor(candidate({ type: "cold_war" }))).toBeNull();
  });

  it("preserves resolution for legacy conflicts with no usable start turn", () => {
    expect(eligiblePoleVictor(candidate({ startTurn: undefined }))).toBe("B");
    expect(eligiblePoleVictor(candidate({ startTurn: Number.NaN }))).toBe("B");
  });

  it("rejects concluded wars and impossible pole stamps", () => {
    expect(eligiblePoleVictor(candidate({ status: "terms_pending" }))).toBeNull();
    expect(eligiblePoleVictor(candidate({ status: "resolved" }))).toBeNull();
    expect(eligiblePoleVictor(candidate({ poleSinceTurn: 99 }))).toBeNull();
    expect(eligiblePoleVictor(candidate({ poleSinceTurn: 999 }))).toBeNull();
  });
});
