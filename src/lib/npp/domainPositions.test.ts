import { describe, it, expect } from "vitest";
import type { LegislationType } from "@/lib/db/types";
import { deriveDomainPositions, deriveDomainStance } from "./domainPositions";

function makeType(overrides: Partial<LegislationType> = {}): LegislationType {
  return {
    _id: "test-type",
    name: "Test Type",
    description: "",
    policyDomain: "economic",
    subCategory: "test",
    positions: [],
    policyOptions: [
      {
        id: "opt_left",
        name: "Left option",
        stance: "left",
        effectDirection: 1,
        economic: -3,
        social: 0,
      },
      {
        id: "opt_right",
        name: "Right option",
        stance: "right",
        effectDirection: -1,
        economic: 3,
        social: 0,
      },
    ],
    ...overrides,
  };
}

describe("deriveDomainStance", () => {
  it("gives a left-leaning NPP a positive stance toward a left-coded type", () => {
    const type = makeType();
    // economic = -5 (very left), social = 0; axis.econ = -3, axis.social = 0
    // dot = -5 * -3 / 3 = 5 → clamps to 5; with rng=0.5 noise=0 there's no jitter
    const stance = deriveDomainStance(type, -5, 0, () => 0.5, 0);
    expect(stance).toBe(5);
  });

  it("gives a right-leaning NPP a negative stance toward a left-coded type", () => {
    const type = makeType();
    const stance = deriveDomainStance(type, 5, 0, () => 0.5, 0);
    expect(stance).toBe(-5);
  });

  it("uses explicit left stance instead of effectDirection for the leftward axis", () => {
    const type = makeType({
      policyOptions: [
        {
          id: "left_reform",
          name: "Left reform",
          stance: "left",
          effectDirection: -1,
          economic: -3,
          social: -3,
        },
        {
          id: "right_crackdown",
          name: "Right crackdown",
          stance: "right",
          effectDirection: 1,
          economic: 3,
          social: 3,
        },
      ],
    });
    const stance = deriveDomainStance(type, -5, -5, () => 0.5, 0);
    expect(stance).toBe(5);
  });

  it("returns undefined when the type has no leftward options", () => {
    const type = makeType({
      policyOptions: [
        {
          id: "center",
          name: "Center",
          stance: "center",
          effectDirection: 0,
          economic: 0,
          social: 0,
        },
      ],
    });
    expect(deriveDomainStance(type, -5, 0)).toBeUndefined();
  });

  it("returns undefined when the type has no policy options at all", () => {
    const type = makeType({ policyOptions: [] });
    expect(deriveDomainStance(type, -5, 0)).toBeUndefined();
  });

  it("aligns dual-axis types with NPPs whose economic and social positions match", () => {
    const type = makeType({
      policyOptions: [
        {
          id: "left_both",
          name: "Left both",
          stance: "left",
          effectDirection: 1,
          economic: -3,
          social: -3,
        },
      ],
    });
    // axis = (-3, -3), magnitude ≈ 4.243; NPP (-5, -5) gives dot = (15+15)/4.243 ≈ 7.07 → clamps to 5
    const stance = deriveDomainStance(type, -5, -5, () => 0.5, 0);
    expect(stance).toBe(5);
  });

  it("applies jitter around the derived stance", () => {
    const type = makeType();
    // With rng = 0.0 → jitter = -1; rng = 1.0 → jitter ≈ +1; the base stance for a
    // perfectly aligned NPP saturates at +5 even before jitter, so use a less-extreme
    // NPP to observe jitter without the clamp interfering.
    const low = deriveDomainStance(type, -2, 0, () => 0.0, 1.0);
    const high = deriveDomainStance(type, -2, 0, () => 1.0, 1.0);
    // base stance = -2 * -3 / 3 = +2; jitter widens by ±1
    expect(low).toBeCloseTo(1, 5);
    expect(high).toBeCloseTo(3, 5);
  });
});

describe("deriveDomainPositions", () => {
  it("rounds to one decimal place for parity with policies.economic/social", () => {
    const type = makeType({ _id: "type-a" });
    // base = -2 * -3 / 3 = 2.0; jitter via rng=0.7 → (0.7 * 2 - 1) * 1.0 = 0.4 → stance 2.4
    const out = deriveDomainPositions([type], -2, 0, () => 0.7, 1.0);
    expect(out).toEqual({ "type-a": 2.4 });
  });

  it("skips types with no derivable axis", () => {
    const usable = makeType({ _id: "type-a" });
    const empty = makeType({ _id: "type-b", policyOptions: [] });
    const out = deriveDomainPositions([usable, empty], -3, 0, () => 0.5, 0);
    expect(Object.keys(out)).toEqual(["type-a"]);
  });

  it("returns empty map when no types are derivable", () => {
    const empty = makeType({ _id: "type-b", policyOptions: [] });
    const out = deriveDomainPositions([empty], -3, 0);
    expect(out).toEqual({});
  });
});
