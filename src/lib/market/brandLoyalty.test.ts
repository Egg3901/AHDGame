import { describe, expect, it } from "vitest";
import {
  ACCRUAL_RATE,
  DECAY_ERRATIC,
  DECAY_ERRATIC_DOWNWARD_FACTOR,
  DECAY_GOUGE,
  DECAY_IDLE,
  DECAY_UNDERDELIVER,
  LOYAL_POOL_FRACTION,
  LOYALTY_MAX,
  applyFacilityLoss,
  clampLoyalty,
  isContested,
  loyalSliceShares,
  loyaltyLabel,
  updateBrandLoyalty,
} from "./brandLoyalty";

// A consistent, delivering, contested corp — the canonical accrual case.
const accruing = { loyalty: 40, postureNorm: 0.1, posture: 0.1, fill: 0.8, contested: true };

describe("loyaltyLabel", () => {
  it("maps the five bands", () => {
    expect(loyaltyLabel(0)).toBe("Unknown");
    expect(loyaltyLabel(19)).toBe("Unknown");
    expect(loyaltyLabel(20)).toBe("Emerging");
    expect(loyaltyLabel(44)).toBe("Emerging");
    expect(loyaltyLabel(45)).toBe("Respected");
    expect(loyaltyLabel(70)).toBe("Trusted");
    expect(loyaltyLabel(89)).toBe("Trusted");
    expect(loyaltyLabel(90)).toBe("Iconic");
    expect(loyaltyLabel(100)).toBe("Iconic");
  });
  it("clamps out-of-range", () => {
    expect(loyaltyLabel(-5)).toBe("Unknown");
    expect(loyaltyLabel(9999)).toBe("Iconic");
    expect(loyaltyLabel(Number.NaN)).toBe("Unknown");
  });
});

describe("clampLoyalty", () => {
  it("bounds to [0,100] and handles junk", () => {
    expect(clampLoyalty(-1)).toBe(0);
    expect(clampLoyalty(101)).toBe(100);
    expect(clampLoyalty(Number.NaN)).toBe(0);
    expect(clampLoyalty(Infinity)).toBe(0); // all non-finite → 0 (garbage in, no loyalty)
    expect(clampLoyalty(50)).toBe(50);
  });
});

describe("updateBrandLoyalty — accrual", () => {
  it("accrues when consistent, delivering, and contested", () => {
    const r = updateBrandLoyalty(accruing);
    expect(r.loyalty).toBe(40 + ACCRUAL_RATE);
    expect(r.outcome).toBe("accrued");
  });
  it("does NOT accrue in a monopoly (uncontested), decays idle instead", () => {
    const r = updateBrandLoyalty({ ...accruing, contested: false });
    expect(r.loyalty).toBe(40 - DECAY_IDLE);
    expect(r.outcome).toBe("idle-decay");
  });
  it("does NOT accrue if delivery is weak but not under the penalty floor", () => {
    // fill 0.45: below DELIVER_FILL (0.5) but above UNDERDELIVER_FILL (0.35) → neither accrue nor penalize
    const r = updateBrandLoyalty({ ...accruing, fill: 0.45 });
    expect(r.loyalty).toBe(40 - DECAY_IDLE);
    expect(r.outcome).toBe("idle-decay");
  });
  it("caps at LOYALTY_MAX", () => {
    const r = updateBrandLoyalty({ ...accruing, loyalty: 99.7 });
    expect(r.loyalty).toBe(LOYALTY_MAX);
  });
});

describe("updateBrandLoyalty — gouging", () => {
  it("punishes a sharp upward jump vs own norm and skips accrual", () => {
    const r = updateBrandLoyalty({ ...accruing, posture: 0.1 + 0.09 }); // gap 0.09 > GOUGE_JUMP 0.08
    expect(r.loyalty).toBe(40 - DECAY_GOUGE);
    expect(r.outcome).toBe("gouged");
  });
  it("gouging is judged against the PRE-jump norm (norm updates last)", () => {
    const r = updateBrandLoyalty({
      loyalty: 50,
      postureNorm: 0.0,
      posture: 0.2,
      fill: 0.9,
      contested: true,
    });
    expect(r.outcome).toBe("gouged");
    // norm moved only a fraction toward the new posture, not to it
    expect(r.postureNorm).toBeGreaterThan(0);
    expect(r.postureNorm).toBeLessThan(0.2);
  });
});

describe("updateBrandLoyalty — erratic", () => {
  it("penalizes drifting off norm (upward, below gouge threshold)", () => {
    // gap 0.06: > CONSISTENCY_BAND (0.04), < GOUGE_JUMP (0.08)
    const r = updateBrandLoyalty({ ...accruing, posture: 0.16, fill: 0.8 });
    expect(r.loyalty).toBe(40 - DECAY_ERRATIC);
    expect(r.outcome).toBe("erratic");
  });
  it("softens the penalty for DOWNWARD moves (a sale, not a betrayal)", () => {
    // gap -0.06: downward drift off norm
    const r = updateBrandLoyalty({ ...accruing, posture: 0.04, fill: 0.8 });
    expect(r.loyalty).toBe(40 - DECAY_ERRATIC * DECAY_ERRATIC_DOWNWARD_FACTOR);
    expect(r.outcome).toBe("erratic");
  });
});

describe("updateBrandLoyalty — under-delivery stacks", () => {
  it("under-delivery alone penalizes", () => {
    const r = updateBrandLoyalty({ ...accruing, fill: 0.3 });
    expect(r.loyalty).toBe(40 - DECAY_UNDERDELIVER);
    expect(r.outcome).toBe("underdelivered");
  });
  it("stacks with a gouging penalty", () => {
    const r = updateBrandLoyalty({
      loyalty: 60,
      postureNorm: 0.0,
      posture: 0.2,
      fill: 0.2,
      contested: true,
    });
    expect(r.loyalty).toBe(60 - DECAY_GOUGE - DECAY_UNDERDELIVER);
    expect(r.outcome).toBe("gouged"); // primary outcome is the pricing sin
  });
});

describe("updateBrandLoyalty — norm seeding & floor", () => {
  it("seeds norm to current posture on first observation (no first-turn gap)", () => {
    const r = updateBrandLoyalty({
      loyalty: 0,
      postureNorm: null,
      posture: 0.3,
      fill: 0.8,
      contested: true,
    });
    // gap is 0 because norm seeded to posture → accrues (contested + delivering)
    expect(r.outcome).toBe("accrued");
    expect(r.postureNorm).toBeCloseTo(0.3, 10);
  });
  it("does not idle-decay below zero and reports held at floor", () => {
    const r = updateBrandLoyalty({
      loyalty: 0,
      postureNorm: 0.1,
      posture: 0.1,
      fill: 0.8,
      contested: false,
    });
    expect(r.loyalty).toBe(0);
    expect(r.outcome).toBe("held");
  });
});

describe("applyFacilityLoss (Boeing rule)", () => {
  it("dents loyalty proportional to lost revenue share", () => {
    expect(applyFacilityLoss(80, 0.25)).toBe(80 - 80 * 0.25); // 60
    expect(applyFacilityLoss(50, 1)).toBe(0);
    expect(applyFacilityLoss(50, 0)).toBe(50);
  });
  it("clamps share and handles junk", () => {
    expect(applyFacilityLoss(50, 2)).toBe(0);
    expect(applyFacilityLoss(50, -1)).toBe(50);
    expect(applyFacilityLoss(50, Number.NaN)).toBe(50);
  });
});

describe("isContested", () => {
  it("true only when a rival is meaningfully cheaper", () => {
    expect(isContested(0.1, [0.05])).toBe(true); // 0.05 <= 0.1 - 0.05
    expect(isContested(0.1, [0.06])).toBe(false); // gap only 0.04 < CONTEST_GAP
    expect(isContested(0.1, [])).toBe(false);
    expect(isContested(-0.1, [0.2, 0.0])).toBe(false); // you're the cheapest
  });
});

describe("loyalSliceShares — relative & finite", () => {
  it("equal loyalties → equal split of the loyal pool (no one advantaged)", () => {
    const shares = loyalSliceShares([
      { id: "a", loyalty: 60, demandShare: 1 },
      { id: "b", loyalty: 60, demandShare: 1 },
    ]);
    expect(shares.get("a")).toBeCloseTo(LOYAL_POOL_FRACTION / 2, 10);
    expect(shares.get("b")).toBeCloseTo(LOYAL_POOL_FRACTION / 2, 10);
  });
  it("advantage appears only when loyalties differ", () => {
    const shares = loyalSliceShares([
      { id: "hi", loyalty: 90, demandShare: 1 },
      { id: "lo", loyalty: 30, demandShare: 1 },
    ]);
    expect(shares.get("hi")!).toBeGreaterThan(shares.get("lo")!);
    expect(shares.get("hi")! + shares.get("lo")!).toBeCloseTo(LOYAL_POOL_FRACTION, 10);
  });
  it("caps a seller's slice at its own demand share", () => {
    const shares = loyalSliceShares([
      { id: "big", loyalty: 100, demandShare: 0.05 },
      { id: "small", loyalty: 100, demandShare: 1 },
    ]);
    expect(shares.get("big")).toBeCloseTo(0.05, 10); // capped, can't reserve demand it never serves
  });
  it("noise floor: low-loyalty sellers get nothing", () => {
    const shares = loyalSliceShares([
      { id: "faithful", loyalty: 50, demandShare: 1 },
      { id: "nobody", loyalty: 3, demandShare: 1 },
    ]);
    expect(shares.has("nobody")).toBe(false);
    expect(shares.get("faithful")).toBeCloseTo(LOYAL_POOL_FRACTION, 10);
  });
  it("empty / all-below-floor → no reservations", () => {
    expect(loyalSliceShares([]).size).toBe(0);
    expect(loyalSliceShares([{ id: "x", loyalty: 1, demandShare: 1 }]).size).toBe(0);
  });
});
