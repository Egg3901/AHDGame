import { describe, expect, it } from "vitest";
import {
  REG_DRIVE_MAX_BOOST_PER_STATE,
  calculateRegistrationDriveBoost,
  planRegistrationDriveDraw,
  planRegistrationDriveSourcing,
} from "./registrationDrive";
import type { SurplusPartyView } from "./surplusSourcing";

function view(partyId: string, orgPct: number, regPct: number): SurplusPartyView {
  return { rowId: `row_${partyId}`, partyId, orgPct, regPct };
}

// Player suggestion #81 — voter-registration drive helpers.

describe("calculateRegistrationDriveBoost", () => {
  it("scales linearly with spend below the cap (same $/point curve as GOTV)", () => {
    // $250 per state at $5000/point = 0.05 pp, under the 0.1 cap.
    expect(calculateRegistrationDriveBoost(250, 5000)).toBeCloseTo(0.05, 6);
  });

  it("clamps to REG_DRIVE_MAX_BOOST_PER_STATE for large spend", () => {
    // $10k per state / $5000 = 2.0 pp raw → capped.
    expect(calculateRegistrationDriveBoost(10_000, 5000)).toBe(REG_DRIVE_MAX_BOOST_PER_STATE);
  });

  it("returns 0 for non-positive spend or dollars-per-point", () => {
    expect(calculateRegistrationDriveBoost(0, 5000)).toBe(0);
    expect(calculateRegistrationDriveBoost(-100, 5000)).toBe(0);
    expect(calculateRegistrationDriveBoost(250, 0)).toBe(0);
  });
});

describe("planRegistrationDriveDraw", () => {
  it("draws from unregistered first", () => {
    const draw = planRegistrationDriveDraw(0.08, 10, 5);
    expect(draw.applied).toBeCloseTo(0.08, 6);
    expect(draw.fromUnregistered).toBeCloseTo(0.08, 6);
    expect(draw.fromIndependent).toBe(0);
  });

  it("falls back to independent when unregistered is exhausted", () => {
    const draw = planRegistrationDriveDraw(0.1, 0.03, 5);
    expect(draw.applied).toBeCloseTo(0.1, 6);
    expect(draw.fromUnregistered).toBeCloseTo(0.03, 6);
    expect(draw.fromIndependent).toBeCloseTo(0.07, 6);
  });

  it("is bounded by total pool capacity so no bucket goes negative", () => {
    const draw = planRegistrationDriveDraw(0.1, 0.02, 0.01);
    expect(draw.applied).toBeCloseTo(0.03, 6);
    expect(draw.fromUnregistered).toBeCloseTo(0.02, 6);
    expect(draw.fromIndependent).toBeCloseTo(0.01, 6);
    // Sum drawn from the pool exactly equals the applied registration gain →
    // the per-state 100% pool invariant is preserved.
    expect(draw.fromUnregistered + draw.fromIndependent).toBeCloseTo(draw.applied, 6);
  });

  it("applies nothing when the pool is empty", () => {
    const draw = planRegistrationDriveDraw(0.1, 0, 0);
    expect(draw.applied).toBe(0);
    expect(draw.fromUnregistered).toBe(0);
    expect(draw.fromIndependent).toBe(0);
  });
});

describe("planRegistrationDriveSourcing", () => {
  const buyer = "gop";

  it("takes the whole boost from the pool when the pool can cover it", () => {
    const views = [view(buyer, 40, 10), view("dem", 20, 50)];
    const plan = planRegistrationDriveSourcing(0.1, 5, 5, views, buyer);

    expect(plan.applied).toBeCloseTo(0.1, 6);
    expect(plan.pool.applied).toBeCloseTo(0.1, 6);
    expect(plan.surplus).toEqual([]);
  });

  it("sources the shortfall from over-registered parties when the pool is empty", () => {
    // Every US state pool has been 0 since live turn ~155; without this the
    // drive applied nothing at all.
    const views = [view(buyer, 40, 10), view("dem", 20, 50)];
    const plan = planRegistrationDriveSourcing(0.1, 0, 0, views, buyer);

    expect(plan.applied).toBeCloseTo(0.1, 6);
    expect(plan.pool.applied).toBe(0);
    expect(plan.surplus).toHaveLength(1);
    expect(plan.surplus[0].partyId).toBe("dem");
    expect(plan.surplus[0].delta).toBeCloseTo(-0.1, 6);
  });

  it("draws the pool first and only the remainder from surplus", () => {
    const views = [view(buyer, 40, 10), view("dem", 20, 50)];
    const plan = planRegistrationDriveSourcing(0.1, 0.04, 0, views, buyer);

    expect(plan.pool.applied).toBeCloseTo(0.04, 6);
    expect(plan.surplus[0].delta).toBeCloseTo(-0.06, 6);
    expect(plan.applied).toBeCloseTo(0.1, 6);
  });

  it("never draws from the buying party's own surplus", () => {
    // The buyer is itself above target; it must not fund its own drive.
    const views = [view(buyer, 10, 40)];
    const plan = planRegistrationDriveSourcing(0.1, 0, 0, views, buyer);

    expect(plan.applied).toBe(0);
    expect(plan.surplus).toEqual([]);
  });

  it("applies only what pool and surplus can jointly supply", () => {
    const views = [view(buyer, 40, 10), view("dem", 20, 20.03)];
    const plan = planRegistrationDriveSourcing(0.1, 0, 0, views, buyer);

    // Donor surplus is 0.03; nothing is minted beyond it.
    expect(plan.applied).toBeCloseTo(0.03, 6);
  });

  it("applies nothing when neither pool nor surplus can supply", () => {
    const views = [view(buyer, 40, 10), view("dem", 20, 20)];
    const plan = planRegistrationDriveSourcing(0.1, 0, 0, views, buyer);

    expect(plan.applied).toBe(0);
    expect(plan.surplus).toEqual([]);
  });
});
