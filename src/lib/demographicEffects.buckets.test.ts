/**
 * Bucket-targeted legislation effects — the `{ dim, bucket }` channel that
 * replaces `groupId` on `DemographicEffect`.
 *
 * The point of the channel is that it reaches the granular vote path directly
 * rather than through an archetype's fuzzy bucket projection, so the tests
 * that matter are the end-to-end ones: a bucket-targeted law must move the
 * leans and turnouts of exactly the units that carry that bucket.
 */

import { describe, expect, it } from "vitest";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types/demographics";
import type { DemographicEffect } from "@/lib/db/types/legislation";
// Side-effect import — populates stateCensusData so real Layer-1 cells derive.
import "@/lib/seeds/stateDemographics";
import {
  buildGranularElectorateSubstrate,
  clearGranularElectorateCache,
} from "@/lib/demographics/granularElectorate";
import {
  LEAN_MAX_DEVIATION_FROM_BASELINE,
  LEAN_SHIFT_RATE_PER_TURN,
  LEAN_TURNOUT_DECAY_RATE_PER_TURN,
  buildDemographicUpdates,
  calculateDemographicShiftsByTarget,
  demographicEffectTargetKey,
} from "./demographicEffects";
import type { ActivePolicy, LegislationTypeMap } from "./policyEffects";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function legTypeMap(effects: DemographicEffect[]): LegislationTypeMap {
  return new Map([["leg1", { _id: "leg1", demographicEffects: effects } as never]]);
}

function policy(economic: number): ActivePolicy {
  return {
    _id: "policy1",
    stateId: "PA",
    legislationTypeId: "leg1",
    economic,
    social: 0,
    selectedOptionId: "opt1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    scopeMultiplier: 1,
  } as unknown as ActivePolicy;
}

function demographics(overrides?: Partial<StateDemographics>): StateDemographics {
  return {
    _id: "PA",
    countryId: "US",
    categoryWeights: { voterGroups: 100 },
    groups: {},
    lastUpdated: FIXED_DATE,
    ...overrides,
  };
}

describe("demographicEffectTargetKey", () => {
  it("keys a bucket target as dim:bucket", () => {
    expect(
      demographicEffectTargetKey({
        dim: "education",
        bucket: "no_college",
        target: "economicLean",
        direction: 1,
      })
    ).toBe("education:no_college");
  });

  it("keys a legacy archetype target as its groupId", () => {
    expect(demographicEffectTargetKey({ groupId: "union_trades", direction: 1 })).toBe(
      "union_trades"
    );
  });

  it("refuses a bucket target on the population channel", () => {
    // A bucket's population IS the region's raked census marginal — legislation
    // has no lever on it, and silently accepting one would look like it did.
    expect(demographicEffectTargetKey({ dim: "race", bucket: "white", direction: 1 })).toBeNull();
    expect(
      demographicEffectTargetKey({
        dim: "race",
        bucket: "white",
        target: "population",
        direction: 1,
      })
    ).toBeNull();
  });
});

describe("bucket drift on the live demographics doc", () => {
  const effects: DemographicEffect[] = [
    { dim: "education", bucket: "no_college", target: "economicLean", direction: 1 },
  ];

  it("writes the drift to the Layer-1 position overlay, not to a group", () => {
    const shifts = calculateDemographicShiftsByTarget([policy(3)], legTypeMap(effects));
    expect(shifts.economicLean["education:no_college"]).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN, 10);

    const updates = buildDemographicUpdates(demographics(), shifts, new Map(), true);
    expect(updates["layer1PositionOverrides.education.no_college.economicLean"]).toBeCloseTo(
      LEAN_SHIFT_RATE_PER_TURN,
      10
    );
    expect(Object.keys(updates).some((k) => k.startsWith("groups."))).toBe(false);
  });

  it("caps the accumulated drift at the deviation band", () => {
    const shifts = calculateDemographicShiftsByTarget([policy(3)], legTypeMap(effects));
    const atCap = demographics({
      layer1PositionOverrides: {
        education: {
          no_college: { economicLean: LEAN_MAX_DEVIATION_FROM_BASELINE, socialLean: 0 },
        },
      },
    });
    const updates = buildDemographicUpdates(atCap, shifts, new Map(), true);
    expect(updates["layer1PositionOverrides.education.no_college.economicLean"]).toBeUndefined();
  });

  it("decays stored drift back to zero when no law targets the bucket", () => {
    const stored = 1;
    const drifted = demographics({
      layer1PositionOverrides: {
        education: { no_college: { economicLean: stored, socialLean: 0 } },
      },
    });
    const updates = buildDemographicUpdates(
      drifted,
      { population: {}, economicLean: {}, socialLean: {}, turnout: {} },
      new Map(),
      true
    );
    expect(updates["layer1PositionOverrides.education.no_college.economicLean"]).toBeCloseTo(
      stored * (1 - LEAN_TURNOUT_DECAY_RATE_PER_TURN),
      10
    );
  });
});

describe("bucket drift reaches the granular vote path", () => {
  const categories: DemographicCategory[] = [
    { _id: "voterGroups", name: "Voter Groups", defaultWeight: 100, groups: [] },
  ];

  function substrateFor(overrides?: Partial<StateDemographics>) {
    clearGranularElectorateCache();
    return buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "PA",
      preset: "2019-default",
      statePopulation: 1_000_000,
      demographics: demographics(overrides),
      categories,
      demographicDefaults: null,
      enriched: [],
    });
  }

  it("pulls the lean of units carrying the targeted bucket and leaves the others alone", () => {
    const base = substrateFor();
    const drifted = substrateFor({
      layer1PositionOverrides: { education: { no_college: { economicLean: 1, socialLean: 0 } } },
    });
    expect(base).not.toBeNull();
    expect(drifted).not.toBeNull();

    let moved = 0;
    let unmoved = 0;
    for (const [unitId, group] of Object.entries(drifted!.demographics.groups)) {
      const before = base!.demographics.groups[unitId];
      if (!before) continue;
      const weight = drifted!.units.find((u) => u.id === unitId)?.bucketWeights[
        "education:no_college"
      ];
      const delta = group.economicLean - before.economicLean;
      if (weight) {
        // Fold is linear in bucket membership, less the ±5 axis clamp.
        expect(delta).toBeGreaterThan(0);
        moved++;
      } else {
        expect(delta).toBe(0);
        unmoved++;
      }
    }
    expect(moved).toBeGreaterThan(0);
    expect(unmoved).toBeGreaterThan(0);
  });

  it("raises the turnout of units carrying the targeted bucket", () => {
    const base = substrateFor();
    const drifted = substrateFor({
      layer1TurnoutOverrides: { age: { young: 5 } },
    });
    expect(base).not.toBeNull();
    const raised = Object.entries(drifted!.demographics.groups).filter(
      ([unitId, g]) => (g.turnout ?? 0) > (base!.demographics.groups[unitId]?.turnout ?? 0)
    );
    expect(raised.length).toBeGreaterThan(0);
  });
});
