import { describe, it, expect } from "vitest";
import { calculateDemographicShifts, SHIFT_RATE_PER_TURN } from "./demographicEffects";
import type { ActivePolicy, LegislationTypeMap } from "./policyEffects";

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<ActivePolicy>): ActivePolicy {
  return {
    _id: "policy1",
    stateId: "PA",
    legislationTypeId: "leg1",
    economic: 0,
    social: 0,
    selectedOptionId: "opt1",
    createdAt: new Date(),
    updatedAt: new Date(),
    scopeMultiplier: 1.0,
    ...overrides,
  } as ActivePolicy;
}

function makeLegTypeMap(
  entries: Array<{
    id: string;
    demographicEffects: Array<{ groupId: string; direction: number }>;
  }>
): LegislationTypeMap {
  const map: LegislationTypeMap = new Map();
  for (const entry of entries) {
    map.set(entry.id, {
      _id: entry.id,
      demographicEffects: entry.demographicEffects,
    } as never);
  }
  return map;
}

// ─── calculateDemographicShifts ─────────────────────────────────────────────

describe("calculateDemographicShifts", () => {
  it("returns empty shifts when no policies have demographic effects", () => {
    const legTypeMap = makeLegTypeMap([{ id: "leg1", demographicEffects: [] }]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: 3 })];

    const shifts = calculateDemographicShifts(policies, legTypeMap);
    expect(Object.keys(shifts)).toHaveLength(0);
  });

  it("returns empty shifts when legislation type is not found", () => {
    const legTypeMap = makeLegTypeMap([]);
    const policies = [makePolicy({ legislationTypeId: "nonexistent", economic: 3 })];

    const shifts = calculateDemographicShifts(policies, legTypeMap);
    expect(Object.keys(shifts)).toHaveLength(0);
  });

  it("calculates positive shift for positive direction + positive strength", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "education",
        demographicEffects: [{ groupId: "college", direction: 1 }],
      },
    ]);

    const policies = [
      makePolicy({
        legislationTypeId: "education",
        economic: 3, // full strength → normalized to 1.0
        scopeMultiplier: 1.0,
      }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);

    // direction(1) * strength(1.0) * scope(1.0) * SHIFT_RATE(0.1) = 0.1
    expect(shifts.college).toBeCloseTo(0.1, 6);
  });

  it("calculates negative shift for positive direction + negative strength", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "education",
        demographicEffects: [{ groupId: "college", direction: 1 }],
      },
    ]);

    const policies = [
      makePolicy({
        legislationTypeId: "education",
        economic: -3,
        scopeMultiplier: 1.0,
      }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);
    expect(shifts.college).toBeCloseTo(-0.1, 6);
  });

  it("federal policies have reduced impact via scopeMultiplier", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "education",
        demographicEffects: [{ groupId: "college", direction: 1 }],
      },
    ]);

    const statePolicy = makePolicy({
      legislationTypeId: "education",
      economic: 3,
      scopeMultiplier: 1.0,
    });

    const federalPolicy = makePolicy({
      legislationTypeId: "education",
      economic: 3,
      scopeMultiplier: 1 / 3,
    });

    const stateShifts = calculateDemographicShifts([statePolicy], legTypeMap);
    const federalShifts = calculateDemographicShifts([federalPolicy], legTypeMap);

    expect(federalShifts.college).toBeCloseTo(stateShifts.college / 3, 6);
  });

  it("multiple policies affecting the same group accumulate", () => {
    const legTypeMap = makeLegTypeMap([
      { id: "education", demographicEffects: [{ groupId: "college", direction: 1 }] },
      { id: "research", demographicEffects: [{ groupId: "college", direction: 0.5 }] },
    ]);

    const policies = [
      makePolicy({ legislationTypeId: "education", economic: 3, scopeMultiplier: 1.0 }),
      makePolicy({ legislationTypeId: "research", economic: 3, scopeMultiplier: 1.0 }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);

    // education: 1 * 1.0 * 1.0 * 0.1 = 0.1
    // research: 0.5 * 1.0 * 1.0 * 0.1 = 0.05
    // total = 0.15
    expect(shifts.college).toBeCloseTo(0.15, 6);
  });

  it("opposing policies can cancel each other out", () => {
    const legTypeMap = makeLegTypeMap([
      { id: "pro_edu", demographicEffects: [{ groupId: "college", direction: 1 }] },
      { id: "anti_edu", demographicEffects: [{ groupId: "college", direction: -1 }] },
    ]);

    const policies = [
      makePolicy({ legislationTypeId: "pro_edu", economic: 3, scopeMultiplier: 1.0 }),
      makePolicy({ legislationTypeId: "anti_edu", economic: 3, scopeMultiplier: 1.0 }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);

    // +0.1 and -0.1 → net 0
    expect(shifts.college).toBeCloseTo(0, 6);
  });

  it("moderate policy strength produces proportionally smaller shifts", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "education",
        demographicEffects: [{ groupId: "college", direction: 1 }],
      },
    ]);

    const fullStrength = makePolicy({
      legislationTypeId: "education",
      economic: 3,
      scopeMultiplier: 1.0,
    });

    const halfStrength = makePolicy({
      legislationTypeId: "education",
      economic: 1.5,
      scopeMultiplier: 1.0,
    });

    const fullShifts = calculateDemographicShifts([fullStrength], legTypeMap);
    const halfShifts = calculateDemographicShifts([halfStrength], legTypeMap);

    expect(halfShifts.college).toBeCloseTo(fullShifts.college / 2, 6);
  });

  it("zero economic strength produces zero shift", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "education",
        demographicEffects: [{ groupId: "college", direction: 1 }],
      },
    ]);

    const policies = [
      makePolicy({
        legislationTypeId: "education",
        economic: 0,
        scopeMultiplier: 1.0,
      }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);
    expect(shifts.college).toBe(0);
  });

  it("policy with multiple demographic effects shifts all groups", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "urbanization",
        demographicEffects: [
          { groupId: "urban", direction: 1 },
          { groupId: "rural", direction: -0.5 },
          { groupId: "suburban", direction: 0.3 },
        ],
      },
    ]);

    const policies = [
      makePolicy({
        legislationTypeId: "urbanization",
        economic: 3,
        scopeMultiplier: 1.0,
      }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);

    expect(shifts.urban).toBeCloseTo(SHIFT_RATE_PER_TURN, 6);
    expect(shifts.rural).toBeCloseTo(-0.5 * SHIFT_RATE_PER_TURN, 6);
    expect(shifts.suburban).toBeCloseTo(0.3 * SHIFT_RATE_PER_TURN, 6);
  });
});

// ─── Balance: shift rate sanity ─────────────────────────────────────────────

describe("balance: demographic shift rates are bounded and gradual", () => {
  it("SHIFT_RATE_PER_TURN is 0.1% — small and gradual", () => {
    expect(SHIFT_RATE_PER_TURN).toBe(0.1);
  });

  it("maximum single-policy shift per turn is 0.1% at full strength", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "max",
        demographicEffects: [{ groupId: "test", direction: 1 }],
      },
    ]);

    const policy = makePolicy({
      legislationTypeId: "max",
      economic: 3, // max strength
      scopeMultiplier: 1.0,
    });

    const shifts = calculateDemographicShifts([policy], legTypeMap);
    expect(Math.abs(shifts.test)).toBeLessThanOrEqual(SHIFT_RATE_PER_TURN + 0.001);
  });

  it("48 turns of max shift moves demographic only ~4.8% (one game year)", () => {
    const shiftPerTurn = SHIFT_RATE_PER_TURN; // 0.1
    const turnsPerYear = 48;
    const yearlyShift = shiftPerTurn * turnsPerYear;
    expect(yearlyShift).toBeCloseTo(4.8, 1);
    // This is reasonable: a full-strength policy shifts a group by ~5% in a game year
  });

  it("stacking 3 policies on same group accumulates but stays bounded", () => {
    const legTypeMap = makeLegTypeMap([
      { id: "a", demographicEffects: [{ groupId: "college", direction: 1 }] },
      { id: "b", demographicEffects: [{ groupId: "college", direction: 0.8 }] },
      { id: "c", demographicEffects: [{ groupId: "college", direction: 0.6 }] },
    ]);

    const policies = [
      makePolicy({ legislationTypeId: "a", economic: 3, scopeMultiplier: 1.0 }),
      makePolicy({ legislationTypeId: "b", economic: 3, scopeMultiplier: 1.0 }),
      makePolicy({ legislationTypeId: "c", economic: 3, scopeMultiplier: 1.0 }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);

    // Combined: (1 + 0.8 + 0.6) * 1.0 * 1.0 * 0.1 = 0.24
    expect(shifts.college).toBeCloseTo(0.24, 4);
    // Per year: 0.24 * 48 = ~11.5% — significant but not game-breaking
    expect(shifts.college * 48).toBeLessThan(15);
  });

  it("federal + state policy stacking is additive", () => {
    const legTypeMap = makeLegTypeMap([
      { id: "fed", demographicEffects: [{ groupId: "college", direction: 1 }] },
      { id: "state", demographicEffects: [{ groupId: "college", direction: 1 }] },
    ]);

    const policies = [
      makePolicy({ legislationTypeId: "fed", economic: 3, scopeMultiplier: 1 / 3 }),
      makePolicy({ legislationTypeId: "state", economic: 3, scopeMultiplier: 1.0 }),
    ];

    const shifts = calculateDemographicShifts(policies, legTypeMap);

    // fed: 1 * 1.0 * (1/3) * 0.1 ≈ 0.0333
    // state: 1 * 1.0 * 1.0 * 0.1 = 0.1
    // total ≈ 0.1333
    expect(shifts.college).toBeCloseTo(0.1333, 3);
  });
});
