import { describe, expect, it } from "vitest";
import { defenceAction, defenceBand } from "./currencyDefence";

const base = { hasBand: false, ownBand: false, turnsSinceBandChange: null, cooldownTurns: 6 };

describe("NPP engine 6.13 currency defence", () => {
  it("sets a band only after a fall of at least 15%", () => {
    expect(defenceAction({ ...base, depreciation: 0.2 })).toBe("set");
    expect(defenceAction({ ...base, depreciation: 0.1 })).toBe("none");
    expect(defenceAction({ ...base, depreciation: -0.3 })).toBe("none");
    expect(defenceAction({ ...base, depreciation: null })).toBe("none");
  });

  it("releases only its own band, after the cooldown, once the move settles", () => {
    const own = { ...base, hasBand: true, ownBand: true };
    expect(defenceAction({ ...own, depreciation: 0.02, turnsSinceBandChange: 6 })).toBe("release");
    expect(defenceAction({ ...own, depreciation: 0.02, turnsSinceBandChange: 3 })).toBe("none");
    expect(defenceAction({ ...own, depreciation: 0.08, turnsSinceBandChange: 9 })).toBe("none");
    expect(
      defenceAction({ ...base, hasBand: true, depreciation: 0.01, turnsSinceBandChange: 9 })
    ).toBe("none");
  });

  it("caps further weakening at 5% and clamps to the guardrails", () => {
    expect(defenceBand(2, { floor: 0.5, ceiling: 3 })).toEqual({ floor: 1.8, ceiling: 2.1 });
    expect(defenceBand(2, { floor: 1.9, ceiling: 2.05 })).toEqual({ floor: 1.9, ceiling: 2.05 });
    expect(defenceBand(2, { floor: 2.2, ceiling: 3 })).toBeNull();
  });
});
