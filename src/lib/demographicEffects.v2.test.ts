import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { StateDemographics, DemographicCategory } from "@/lib/db/types/demographics";
import type { DemographicEffect } from "@/lib/db/types/legislation";
import type { EnrichedCandidate } from "@/lib/electionEngine/types";
// Side-effect import — populates stateCensusData with all US states so the
// granular-path acceptance test below can derive real Layer-1 cells.
import "@/lib/seeds/stateDemographics";
import {
  buildGranularElectorateSubstrate,
  clearGranularElectorateCache,
} from "@/lib/demographics/granularElectorate";
import { distributeVotesByGroupLevelAllocation } from "@/lib/electionEngine/voteDistribution";
import {
  LEAN_SHIFT_RATE_PER_TURN,
  LEAN_MAX_DEVIATION_FROM_BASELINE,
  TURNOUT_SHIFT_RATE_PER_TURN,
  TURNOUT_MAX_DEVIATION_FROM_BASELINE,
  LEAN_TURNOUT_DECAY_RATE_PER_TURN,
  SHIFT_RATE_PER_TURN,
  calculateDemographicShifts,
  calculateDemographicShiftsByTarget,
  calculateDurableDemographicShiftsByTarget,
  subtractDurableShifts,
  clampDemographicEffectMagnitude,
  applyBandedShift,
  applyBaselineDecay,
  buildDemographicUpdates,
  buildGroupBaselineMap,
  isLegislationDemographicEffectsV2Enabled,
  processAllStateDemographics,
  type DemographicGroupBaselines,
} from "./demographicEffects";
import type { ActivePolicy, LegislationTypeMap } from "./policyEffects";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function makePolicy(overrides: Partial<ActivePolicy>): ActivePolicy {
  return {
    _id: "policy1",
    stateId: "PA",
    legislationTypeId: "leg1",
    economic: 0,
    social: 0,
    selectedOptionId: "opt1",
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    scopeMultiplier: 1.0,
    ...overrides,
  } as ActivePolicy;
}

function makeLegTypeMap(
  entries: Array<{ id: string; demographicEffects: DemographicEffect[] }>
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

function makeDemographics(overrides?: Partial<StateDemographics>): StateDemographics {
  return {
    _id: "PA",
    countryId: "US",
    categoryWeights: { voterGroups: 100 },
    groups: {
      union_trades: { population: 20, economicLean: -3, socialLean: -0.5, turnout: 63 },
      small_business: { population: 15, economicLean: 4, socialLean: 2, turnout: 72 },
    },
    lastUpdated: FIXED_DATE,
    ...overrides,
  };
}

function makeBaselines(): Map<string, DemographicGroupBaselines> {
  return new Map([
    ["union_trades", { economicLean: -3, socialLean: -0.5, turnout: 63 }],
    ["small_business", { economicLean: 4, socialLean: 2, turnout: 72 }],
  ]);
}

const VOTER_GROUPS_CATEGORY: DemographicCategory = {
  _id: "voterGroups",
  name: "Voter Groups",
  defaultWeight: 100,
  groups: [
    {
      id: "union_trades",
      name: "Union & Trades",
      defaultEconomicLean: -3,
      defaultSocialLean: -0.5,
      defaultTurnout: 63,
    },
    {
      id: "small_business",
      name: "Small Business",
      defaultEconomicLean: 4,
      defaultSocialLean: 2,
      defaultTurnout: 72,
    },
  ],
};

// ─── Flag helper ────────────────────────────────────────────────────────────

describe("isLegislationDemographicEffectsV2Enabled", () => {
  it("is fail-closed: absent flag / null gameState reads as false", () => {
    expect(isLegislationDemographicEffectsV2Enabled(null)).toBe(false);
    expect(isLegislationDemographicEffectsV2Enabled(undefined)).toBe(false);
    expect(isLegislationDemographicEffectsV2Enabled({})).toBe(false);
    expect(
      isLegislationDemographicEffectsV2Enabled({ legislationDemographicEffectsV2Enabled: false })
    ).toBe(false);
  });

  it("only an explicit true enables", () => {
    expect(
      isLegislationDemographicEffectsV2Enabled({ legislationDemographicEffectsV2Enabled: true })
    ).toBe(true);
  });
});

// ─── Magnitude clamp ────────────────────────────────────────────────────────

describe("clampDemographicEffectMagnitude", () => {
  it("defaults to 1 when absent or non-finite", () => {
    expect(clampDemographicEffectMagnitude(undefined)).toBe(1);
    expect(clampDemographicEffectMagnitude(Number.NaN)).toBe(1);
    expect(clampDemographicEffectMagnitude(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("clamps to [0.25, 3]", () => {
    expect(clampDemographicEffectMagnitude(0.1)).toBe(0.25);
    expect(clampDemographicEffectMagnitude(0.25)).toBe(0.25);
    expect(clampDemographicEffectMagnitude(1.5)).toBe(1.5);
    expect(clampDemographicEffectMagnitude(3)).toBe(3);
    expect(clampDemographicEffectMagnitude(50)).toBe(3);
  });
});

// ─── Shift routing ──────────────────────────────────────────────────────────

describe("calculateDemographicShiftsByTarget", () => {
  it("routes effects without a target to the population channel (backward compat)", () => {
    const legTypeMap = makeLegTypeMap([
      { id: "leg1", demographicEffects: [{ groupId: "union_trades", direction: 1 }] },
    ]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: 3 })];

    const shifts = calculateDemographicShiftsByTarget(policies, legTypeMap);

    expect(shifts.population.union_trades).toBeCloseTo(SHIFT_RATE_PER_TURN, 6);
    expect(Object.keys(shifts.economicLean)).toHaveLength(0);
    expect(Object.keys(shifts.socialLean)).toHaveLength(0);
    expect(Object.keys(shifts.turnout)).toHaveLength(0);
  });

  it("legacy calculateDemographicShifts matches the population channel exactly", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "leg1",
        demographicEffects: [
          { groupId: "union_trades", direction: 1 },
          { groupId: "small_business", target: "economicLean", direction: 1 },
        ],
      },
    ]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: 3 })];

    const legacy = calculateDemographicShifts(policies, legTypeMap);

    // Population math identical to pre-v2: direction × strength × scope × 0.1
    expect(legacy.union_trades).toBeCloseTo(0.1, 6);
    // Lean-target effects must NOT leak into the population channel
    expect(legacy.small_business).toBeUndefined();
  });

  it("computes lean shifts at LEAN_SHIFT_RATE_PER_TURN with the same strength/scope scaling", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "leg1",
        demographicEffects: [{ groupId: "union_trades", target: "economicLean", direction: 1 }],
      },
    ]);

    const statePolicy = makePolicy({ legislationTypeId: "leg1", economic: 3, scopeMultiplier: 1 });
    const federalPolicy = makePolicy({
      legislationTypeId: "leg1",
      economic: 3,
      scopeMultiplier: 1 / 50,
    });

    const stateShifts = calculateDemographicShiftsByTarget([statePolicy], legTypeMap);
    const federalShifts = calculateDemographicShiftsByTarget([federalPolicy], legTypeMap);

    expect(stateShifts.economicLean.union_trades).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN, 6);
    expect(federalShifts.economicLean.union_trades).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN / 50, 8);
  });

  it("a max-strength state law crosses 1.0 lean (10% of the axis) within 20-40 turns", () => {
    // strength 1.0 (economic ±3), magnitude 1, state scope
    const perTurn = LEAN_SHIFT_RATE_PER_TURN;
    const turnsToTenPercent = 1.0 / perTurn;
    expect(turnsToTenPercent).toBeGreaterThanOrEqual(20);
    expect(turnsToTenPercent).toBeLessThanOrEqual(40);
  });

  it("computes socialLean and turnout channels independently", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "leg1",
        demographicEffects: [
          { groupId: "union_trades", target: "socialLean", direction: -1 },
          { groupId: "union_trades", target: "turnout", direction: 1 },
        ],
      },
    ]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: 3 })];

    const shifts = calculateDemographicShiftsByTarget(policies, legTypeMap);

    expect(shifts.socialLean.union_trades).toBeCloseTo(-LEAN_SHIFT_RATE_PER_TURN, 6);
    expect(shifts.turnout.union_trades).toBeCloseTo(TURNOUT_SHIFT_RATE_PER_TURN, 6);
    expect(Object.keys(shifts.economicLean)).toHaveLength(0);
    expect(Object.keys(shifts.population)).toHaveLength(0);
  });

  it("applies the magnitude multiplier, clamped to [0.25, 3]", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "leg1",
        demographicEffects: [
          { groupId: "a", target: "economicLean", direction: 1, magnitude: 2 },
          { groupId: "b", target: "economicLean", direction: 1, magnitude: 99 },
          { groupId: "c", target: "economicLean", direction: 1, magnitude: 0.01 },
        ],
      },
    ]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: 3 })];

    const shifts = calculateDemographicShiftsByTarget(policies, legTypeMap);

    expect(shifts.economicLean.a).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN * 2, 6);
    expect(shifts.economicLean.b).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN * 3, 6);
    expect(shifts.economicLean.c).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN * 0.25, 6);
  });

  it("negative policy strength flips lean direction (lean follows the law's stance)", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "leg1",
        demographicEffects: [{ groupId: "union_trades", target: "economicLean", direction: 1 }],
      },
    ]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: -3 })];

    const shifts = calculateDemographicShiftsByTarget(policies, legTypeMap);
    expect(shifts.economicLean.union_trades).toBeCloseTo(-LEAN_SHIFT_RATE_PER_TURN, 6);
  });

  it("is deterministic for the same input", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "leg1",
        demographicEffects: [
          { groupId: "union_trades", target: "economicLean", direction: 0.7, magnitude: 1.3 },
        ],
      },
    ]);
    const policies = [makePolicy({ legislationTypeId: "leg1", economic: 2 })];

    const results = Array.from(
      { length: 20 },
      () => calculateDemographicShiftsByTarget(policies, legTypeMap).economicLean.union_trades
    );
    expect(new Set(results).size).toBe(1);
  });
});

// ─── Band clamp + decay primitives ──────────────────────────────────────────

describe("applyBandedShift", () => {
  it("caps cumulative deviation at baseline + maxDeviation", () => {
    const next = applyBandedShift(-1.6, -3, 2, LEAN_MAX_DEVIATION_FROM_BASELINE, -5, 5);
    expect(next).toBe(-1.5); // baseline −3 + band 1.5
  });

  it("caps at baseline − maxDeviation for negative shifts", () => {
    const next = applyBandedShift(-4.4, -3, -2, LEAN_MAX_DEVIATION_FROM_BASELINE, -5, 5);
    expect(next).toBe(-4.5);
  });

  it("never snaps a value already outside the band inward", () => {
    // Seeded/admin value −0.5 with baseline −3 is above the band edge (−1.5).
    const pushedOut = applyBandedShift(-0.5, -3, 0.1, LEAN_MAX_DEVIATION_FROM_BASELINE, -5, 5);
    expect(pushedOut).toBe(-0.5); // cannot move further out

    const pulledBack = applyBandedShift(-0.5, -3, -0.1, LEAN_MAX_DEVIATION_FROM_BASELINE, -5, 5);
    expect(pulledBack).toBeCloseTo(-0.6, 9); // moving back toward the band is allowed
  });

  it("respects the absolute lean bounds (±5)", () => {
    expect(applyBandedShift(4.9, 4.5, 2, LEAN_MAX_DEVIATION_FROM_BASELINE, -5, 5)).toBe(5);
    expect(applyBandedShift(-4.9, -4.5, -2, LEAN_MAX_DEVIATION_FROM_BASELINE, -5, 5)).toBe(-5);
  });

  it("respects the absolute turnout bounds (0-100)", () => {
    expect(applyBandedShift(95, 92, 20, TURNOUT_MAX_DEVIATION_FROM_BASELINE, 0, 100)).toBe(100);
    expect(applyBandedShift(4, 8, -20, TURNOUT_MAX_DEVIATION_FROM_BASELINE, 0, 100)).toBe(0);
  });

  it("cumulative lean deviation converges to the band edge, never past it", () => {
    let lean = -3;
    const baseline = -3;
    for (let turn = 0; turn < 100; turn++) {
      lean = applyBandedShift(
        lean,
        baseline,
        LEAN_SHIFT_RATE_PER_TURN,
        LEAN_MAX_DEVIATION_FROM_BASELINE,
        -5,
        5
      );
      expect(lean - baseline).toBeLessThanOrEqual(LEAN_MAX_DEVIATION_FROM_BASELINE + 1e-9);
    }
    expect(lean).toBeCloseTo(baseline + LEAN_MAX_DEVIATION_FROM_BASELINE, 9);
  });

  it("cumulative turnout deviation converges to its band edge", () => {
    let turnout = 63;
    const baseline = 63;
    for (let turn = 0; turn < 200; turn++) {
      turnout = applyBandedShift(
        turnout,
        baseline,
        TURNOUT_SHIFT_RATE_PER_TURN,
        TURNOUT_MAX_DEVIATION_FROM_BASELINE,
        0,
        100
      );
    }
    expect(turnout).toBeCloseTo(baseline + TURNOUT_MAX_DEVIATION_FROM_BASELINE, 9);
  });
});

describe("applyBaselineDecay", () => {
  it("decays proportionally toward baseline at 0.25%/turn of remaining distance", () => {
    const next = applyBaselineDecay(-1.5, -3);
    expect(next).toBeCloseTo(-1.5 - 1.5 * LEAN_TURNOUT_DECAY_RATE_PER_TURN, 9);
  });

  it("decays from both sides of baseline", () => {
    expect(applyBaselineDecay(-4, -3)).toBeGreaterThan(-4);
    expect(applyBaselineDecay(-2, -3)).toBeLessThan(-2);
  });

  it("returns the value unchanged at/near baseline (no write churn)", () => {
    expect(applyBaselineDecay(-3, -3)).toBe(-3);
    expect(applyBaselineDecay(-3.00005, -3)).toBe(-3.00005);
  });

  it("never overshoots baseline", () => {
    let value = 73;
    for (let turn = 0; turn < 5000; turn++) {
      value = applyBaselineDecay(value, 63);
      expect(value).toBeGreaterThanOrEqual(63);
    }
  });
});

// ─── buildGroupBaselineMap ──────────────────────────────────────────────────

describe("buildGroupBaselineMap", () => {
  it("uses template defaults when there is no per-state defaults doc", () => {
    const map = buildGroupBaselineMap([VOTER_GROUPS_CATEGORY], null);
    expect(map.get("union_trades")).toEqual({ economicLean: -3, socialLean: -0.5, turnout: 63 });
  });

  it("prefers the state's seeded defaults over the template", () => {
    const stateDefaults = makeDemographics({
      groups: {
        union_trades: { population: 20, economicLean: -1.8, socialLean: 0.2, turnout: 58 },
      },
    });
    const map = buildGroupBaselineMap([VOTER_GROUPS_CATEGORY], stateDefaults);
    expect(map.get("union_trades")).toEqual({ economicLean: -1.8, socialLean: 0.2, turnout: 58 });
    // Groups absent from the defaults doc fall back to the template
    expect(map.get("small_business")).toEqual({ economicLean: 4, socialLean: 2, turnout: 72 });
  });
});

// ─── buildDemographicUpdates ────────────────────────────────────────────────

describe("buildDemographicUpdates", () => {
  const leanShifts = () => ({
    population: {},
    economicLean: { union_trades: LEAN_SHIFT_RATE_PER_TURN },
    socialLean: {},
    turnout: { union_trades: TURNOUT_SHIFT_RATE_PER_TURN },
  });

  it("flag OFF: lean/turnout shifts are ignored entirely", () => {
    const updates = buildDemographicUpdates(
      makeDemographics(),
      leanShifts(),
      makeBaselines(),
      false
    );
    expect(updates).toEqual({});
  });

  it("flag OFF: population shifts still apply (legacy channel is ungated)", () => {
    const shifts = {
      population: { union_trades: 0.1 },
      economicLean: {},
      socialLean: {},
      turnout: {},
    };
    const updates = buildDemographicUpdates(makeDemographics(), shifts, null, false);
    expect(updates).toEqual({ "groups.union_trades.population": 20.1 });
  });

  it("flag ON: applies lean and turnout shifts from stored values", () => {
    const updates = buildDemographicUpdates(
      makeDemographics(),
      leanShifts(),
      makeBaselines(),
      true
    );
    expect(updates["groups.union_trades.economicLean"]).toBeCloseTo(
      -3 + LEAN_SHIFT_RATE_PER_TURN,
      9
    );
    expect(updates["groups.union_trades.turnout"]).toBeCloseTo(63 + TURNOUT_SHIFT_RATE_PER_TURN, 9);
    // small_business sits exactly at baseline with no shift → no decay writes
    expect(updates["groups.small_business.economicLean"]).toBeUndefined();
  });

  it("flag ON: a group+axis with no active shift decays toward baseline", () => {
    const demographics = makeDemographics({
      groups: {
        union_trades: { population: 20, economicLean: -1.5, socialLean: -0.5, turnout: 70 },
      },
    });
    const noShifts = { population: {}, economicLean: {}, socialLean: {}, turnout: {} };
    const updates = buildDemographicUpdates(demographics, noShifts, makeBaselines(), true);
    // economicLean −1.5 decays toward baseline −3; turnout 70 decays toward 63
    expect(updates["groups.union_trades.economicLean"]).toBeCloseTo(
      -1.5 - 1.5 * LEAN_TURNOUT_DECAY_RATE_PER_TURN,
      9
    );
    expect(updates["groups.union_trades.turnout"]).toBeCloseTo(
      70 - 7 * LEAN_TURNOUT_DECAY_RATE_PER_TURN,
      9
    );
    // socialLean is at baseline → untouched
    expect(updates["groups.union_trades.socialLean"]).toBeUndefined();
  });

  it("flag ON: an active shift suppresses decay for that group+axis only", () => {
    const demographics = makeDemographics({
      groups: {
        union_trades: { population: 20, economicLean: -2, socialLean: 0.5, turnout: 63 },
      },
    });
    const shifts = {
      population: {},
      economicLean: { union_trades: LEAN_SHIFT_RATE_PER_TURN },
      socialLean: {},
      turnout: {},
    };
    const updates = buildDemographicUpdates(demographics, shifts, makeBaselines(), true);
    // economicLean gets the shift (no decay applied on top)
    expect(updates["groups.union_trades.economicLean"]).toBeCloseTo(
      -2 + LEAN_SHIFT_RATE_PER_TURN,
      9
    );
    // socialLean (deviated, unshifted) decays toward its −0.5 baseline
    expect(updates["groups.union_trades.socialLean"]).toBeCloseTo(
      0.5 - 1 * LEAN_TURNOUT_DECAY_RATE_PER_TURN,
      9
    );
  });

  it("flag ON: a group without a baseline is never touched by v2 channels", () => {
    const demographics = makeDemographics({
      groups: { mystery_group: { population: 5, economicLean: 2, socialLean: 2, turnout: 50 } },
    });
    const shifts = {
      population: {},
      economicLean: { mystery_group: 1 },
      socialLean: {},
      turnout: {},
    };
    const updates = buildDemographicUpdates(demographics, shifts, makeBaselines(), true);
    expect(updates).toEqual({});
  });

  it("flag ON: an unset stored lean starts from baseline when shifted", () => {
    const demographics = makeDemographics({
      groups: {
        union_trades: {
          population: 20,
          economicLean: undefined as unknown as number,
          socialLean: -0.5,
          turnout: 63,
        },
      },
    });
    const shifts = {
      population: {},
      economicLean: { union_trades: LEAN_SHIFT_RATE_PER_TURN },
      socialLean: {},
      turnout: {},
    };
    const updates = buildDemographicUpdates(demographics, shifts, makeBaselines(), true);
    expect(updates["groups.union_trades.economicLean"]).toBeCloseTo(
      -3 + LEAN_SHIFT_RATE_PER_TURN,
      9
    );
  });

  it("long-run: sustained max shift + band keeps lean within 15% of axis from baseline", () => {
    let demographics = makeDemographics();
    const baselines = makeBaselines();
    for (let turn = 0; turn < 120; turn++) {
      const updates = buildDemographicUpdates(demographics, leanShifts(), baselines, true);
      const nextLean = updates["groups.union_trades.economicLean"];
      const nextTurnout = updates["groups.union_trades.turnout"];
      demographics = makeDemographics({
        groups: {
          ...demographics.groups,
          union_trades: {
            ...demographics.groups.union_trades,
            economicLean: nextLean ?? demographics.groups.union_trades.economicLean,
            turnout: nextTurnout ?? demographics.groups.union_trades.turnout,
          },
        },
      });
    }
    expect(demographics.groups.union_trades.economicLean).toBeCloseTo(
      -3 + LEAN_MAX_DEVIATION_FROM_BASELINE,
      6
    );
    expect(demographics.groups.union_trades.turnout).toBeLessThanOrEqual(
      63 + TURNOUT_MAX_DEVIATION_FROM_BASELINE + 1e-9
    );
  });
});

// ─── Turn phase (processAllStateDemographics) with MockDb ───────────────────

describe("processAllStateDemographics (turn phase, flag gating)", () => {
  let db: MockDb;

  const cursorOf = (docs: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  });

  const leanLaw = {
    _id: "us_state_business_regulation",
    demographicEffects: [
      { groupId: "small_business", target: "economicLean", direction: 1, magnitude: 1 },
      { groupId: "union_trades", target: "turnout", direction: 1 },
    ],
  };

  const populationLaw = {
    _id: "us_education",
    demographicEffects: [{ groupId: "union_trades", direction: 1 }],
  };

  function seedCollections(opts: { flagOn: boolean; legTypes: unknown[]; policies: unknown[] }) {
    db.collectionMocks.states!.find.mockReturnValue(cursorOf([{ _id: "PA", countryId: "US" }]));
    db.collectionMocks.statePolicies!.find.mockReturnValue(cursorOf(opts.policies));
    db.collectionMocks.legislationTypes!.find.mockReturnValue(cursorOf(opts.legTypes));
    db.collectionMocks.stateDemographics!.find.mockReturnValue(cursorOf([makeDemographics()]));
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      legislationDemographicEffectsV2Enabled: opts.flagOn,
    });
    db.collectionMocks.demographicCategories!.find.mockReturnValue(
      cursorOf([VOTER_GROUPS_CATEGORY])
    );
    db.collectionMocks.demographicDefaults!.find.mockReturnValue(cursorOf([makeDemographics()]));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    // Touch every collection so collectionMocks entries exist before overrides.
    for (const name of [
      "states",
      "statePolicies",
      "legislationTypes",
      "stateDemographics",
      "gameState",
      "demographicCategories",
      "demographicDefaults",
    ]) {
      db.collection(name);
    }
  });

  const paPolicy = {
    _id: "p1",
    stateId: "PA",
    legislationTypeId: "us_state_business_regulation",
    policyOptionId: "opt",
    policyOptionIndex: 6,
    economic: 3,
    social: 0,
    effectDirection: 1,
    enactedAt: FIXED_DATE,
    enactedTurn: 1,
  };

  it("flag ON: applies lean/turnout shifts and refreshes the cached leans", async () => {
    seedCollections({ flagOn: true, legTypes: [leanLaw], policies: [paPolicy] });

    const updated = await processAllStateDemographics(db as unknown as Db);

    expect(updated).toBe(1);
    const bulk = db.collectionMocks.stateDemographics!.bulkWrite;
    expect(bulk).toHaveBeenCalledTimes(1);
    const ops = bulk.mock.calls[0][0] as Array<{
      updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
    }>;
    expect(ops).toHaveLength(1);
    const set = ops[0].updateOne.update.$set;
    expect(set["groups.small_business.economicLean"]).toBeCloseTo(4 + LEAN_SHIFT_RATE_PER_TURN, 9);
    expect(set["groups.union_trades.turnout"]).toBeCloseTo(63 + TURNOUT_SHIFT_RATE_PER_TURN, 9);
    // Cached derived leans are kept consistent on the demographics doc…
    expect(typeof set.cachedEconomicLean).toBe("number");
    expect(typeof set.cachedSocialLean).toBe("number");
    // …and mirrored onto the states collection (map/primary quick reads).
    expect(db.collectionMocks.states!.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it("flag OFF: lean/turnout targets do nothing (no writes at all for a lean-only law)", async () => {
    seedCollections({ flagOn: false, legTypes: [leanLaw], policies: [paPolicy] });

    const updated = await processAllStateDemographics(db as unknown as Db);

    expect(updated).toBe(0);
    expect(db.collectionMocks.stateDemographics!.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.states!.bulkWrite).not.toHaveBeenCalled();
    // v2 data sources are not even queried when the flag is off
    expect(db.collectionMocks.demographicCategories!.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.demographicDefaults!.find).not.toHaveBeenCalled();
  });

  it("flag OFF: legacy population effects still apply exactly as before", async () => {
    seedCollections({
      flagOn: false,
      legTypes: [populationLaw],
      policies: [{ ...paPolicy, legislationTypeId: "us_education" }],
    });

    const updated = await processAllStateDemographics(db as unknown as Db);

    expect(updated).toBe(1);
    const ops = db.collectionMocks.stateDemographics!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    const set = ops[0].updateOne.update.$set;
    expect(set["groups.union_trades.population"]).toBeCloseTo(20 + SHIFT_RATE_PER_TURN, 9);
    // No lean/turnout keys and no cache rewrite with the flag off
    expect(
      Object.keys(set).filter((k) => k.includes("Lean") || k.includes("turnout"))
    ).toHaveLength(0);
  });

  it("flag ON: policy-less states still decay lean deviations toward baseline", async () => {
    seedCollections({ flagOn: true, legTypes: [], policies: [] });
    // State has a deviated lean but no active policies
    db.collectionMocks.stateDemographics!.find.mockReturnValue(
      cursorOf([
        makeDemographics({
          groups: {
            union_trades: { population: 20, economicLean: -1.5, socialLean: -0.5, turnout: 63 },
          },
        }),
      ])
    );

    const updated = await processAllStateDemographics(db as unknown as Db);

    expect(updated).toBe(1);
    const ops = db.collectionMocks.stateDemographics!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $set: Record<string, unknown> } };
    }>;
    const set = ops[0].updateOne.update.$set;
    expect(set["groups.union_trades.economicLean"]).toBeCloseTo(
      -1.5 - 1.5 * LEAN_TURNOUT_DECAY_RATE_PER_TURN,
      9
    );
  });
});

// ─── Durable ("permanent") legislation — calculateDurableDemographicShiftsByTarget / subtractDurableShifts ───

describe("calculateDurableDemographicShiftsByTarget", () => {
  it("isolates only permanent:true lean-axis effects, ignoring ordinary ones", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "landmark",
        demographicEffects: [
          { groupId: "union_trades", target: "economicLean", direction: 1, permanent: true },
          { groupId: "union_trades", target: "socialLean", direction: 1 }, // ordinary — excluded
        ],
      },
    ]);
    const policies: ActivePolicy[] = [makePolicy({ legislationTypeId: "landmark", economic: 3 })];

    const durable = calculateDurableDemographicShiftsByTarget(policies, legTypeMap);
    expect(durable.economicLean.union_trades).toBeCloseTo(LEAN_SHIFT_RATE_PER_TURN, 9);
    expect(durable.socialLean.union_trades).toBeUndefined();
  });

  it("excludes permanent:true population effects (the always-on legacy channel has no durable/temporary distinction)", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "landmark",
        demographicEffects: [
          { groupId: "union_trades", target: "population", direction: 1, permanent: true },
        ],
      },
    ]);
    const policies: ActivePolicy[] = [makePolicy({ legislationTypeId: "landmark", economic: 3 })];

    const durable = calculateDurableDemographicShiftsByTarget(policies, legTypeMap);
    expect(durable.population).toEqual({});
  });

  it("INCLUDES permanent:true turnout effects (the Voting Rights Act's enfranchisement channel)", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "landmark",
        demographicEffects: [
          { groupId: "union_trades", target: "turnout", direction: 1, permanent: true },
        ],
      },
    ]);
    const policies: ActivePolicy[] = [makePolicy({ legislationTypeId: "landmark", economic: 3 })];

    const durable = calculateDurableDemographicShiftsByTarget(policies, legTypeMap);
    expect(durable.turnout.union_trades).toBeCloseTo(TURNOUT_SHIFT_RATE_PER_TURN, 9);
  });

  it("nets opposing durable effects on the same group+axis (beatable by a sustained counter-law)", () => {
    const legTypeMap = makeLegTypeMap([
      {
        id: "landmark",
        demographicEffects: [
          {
            groupId: "union_trades",
            target: "economicLean",
            direction: 1,
            magnitude: 1,
            permanent: true,
          },
        ],
      },
      {
        id: "counter-landmark",
        demographicEffects: [
          {
            groupId: "union_trades",
            target: "economicLean",
            direction: -1,
            magnitude: 3,
            permanent: true,
          },
        ],
      },
    ]);
    const policies: ActivePolicy[] = [
      makePolicy({ legislationTypeId: "landmark", economic: 3 }),
      makePolicy({ legislationTypeId: "counter-landmark", economic: 3 }),
    ];

    const durable = calculateDurableDemographicShiftsByTarget(policies, legTypeMap);
    // magnitude-1 push (+0.035) vs magnitude-3 counter-push (-0.105) nets negative.
    expect(durable.economicLean.union_trades).toBeLessThan(0);
  });
});

describe("subtractDurableShifts", () => {
  it("removes the durable portion from the total, leaving only the temporary rate", () => {
    const total = {
      population: { a: 0.1 },
      economicLean: { union_trades: 0.05, small_business: 0.02 },
      socialLean: {},
      turnout: { a: 1 },
    };
    const durable = {
      population: {},
      economicLean: { union_trades: 0.035 },
      socialLean: {},
      turnout: {},
    };
    const temporary = subtractDurableShifts(total, durable);
    expect(temporary.economicLean.union_trades).toBeCloseTo(0.015, 10);
    // Untouched groups/channels pass through exactly.
    expect(temporary.economicLean.small_business).toBe(0.02);
    expect(temporary.population).toBe(total.population);
    expect(temporary.turnout).toBe(total.turnout);
  });

  it("also removes the durable portion from the TURNOUT channel (the Voting Rights Act's channel)", () => {
    const total = {
      population: {},
      economicLean: {},
      socialLean: {},
      turnout: { union_trades: 0.4 },
    };
    const durable = {
      population: {},
      economicLean: {},
      socialLean: {},
      turnout: { union_trades: 0.25 },
    };
    const temporary = subtractDurableShifts(total, durable);
    expect(temporary.turnout.union_trades).toBeCloseTo(0.15, 10);
  });

  it("is a no-op when durable is empty", () => {
    const total = { population: {}, economicLean: { a: 0.03 }, socialLean: {}, turnout: {} };
    const empty = { population: {}, economicLean: {}, socialLean: {}, turnout: {} };
    expect(subtractDurableShifts(total, empty)).toEqual(total);
  });
});

// ─── Durable legislation through processAllStateDemographics (persisting fake DB) ───

/**
 * Minimal PERSISTING fake `Db` (unlike `MockDb` above, which only supports
 * single-call assertions): needed here because proving "durable, no decay
 * after repeal" requires observing state across MANY simulated turns, the
 * same reason `eraCheckpointTurn.test.ts` builds one for
 * `processEraCheckpointsTurn`.
 */
function setDeep(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

interface FakeBulkOp {
  updateOne: { filter: { _id: string }; update: { $set: Record<string, unknown> } };
}

function createPersistingFakeDb(fixtures: {
  states: Array<{ _id: string; countryId: string }>;
  statePolicies: Array<Record<string, unknown>>;
  legislationTypes: Array<Record<string, unknown>>;
  stateDemographics: StateDemographics[];
  demographicCategories: DemographicCategory[];
  demographicDefaults: StateDemographics[];
  gameState: { _id: string; legislationDemographicEffectsV2Enabled?: boolean };
}) {
  const stores = {
    states: new Map(fixtures.states.map((d) => [d._id, d as Record<string, unknown>])),
    statePolicies: new Map(fixtures.statePolicies.map((d, i) => [String(d._id ?? `p${i}`), d])),
    legislationTypes: new Map(fixtures.legislationTypes.map((d) => [String(d._id), d])),
    stateDemographics: new Map(
      fixtures.stateDemographics.map((d) => [d._id, d as unknown as Record<string, unknown>])
    ),
    demographicCategories: new Map(fixtures.demographicCategories.map((d) => [d._id, d])),
    demographicDefaults: new Map(
      fixtures.demographicDefaults.map((d) => [d._id, d as unknown as Record<string, unknown>])
    ),
  };
  let gameStateDoc: Record<string, unknown> = { ...fixtures.gameState };

  function makeCollection(name: keyof typeof stores) {
    const store = stores[name];
    return {
      find: () => ({ toArray: async () => [...store.values()] }),
      bulkWrite: async (ops: FakeBulkOp[]) => {
        for (const op of ops) {
          const doc = store.get(op.updateOne.filter._id);
          if (!doc) continue;
          for (const [path, value] of Object.entries(op.updateOne.update.$set)) {
            setDeep(doc as Record<string, unknown>, path, value);
          }
        }
        return { modifiedCount: ops.length, matchedCount: ops.length };
      },
    };
  }

  const db = {
    collection: (name: string) => {
      if (name === "gameState") {
        return {
          findOne: async () => gameStateDoc,
          bulkWrite: async () => ({}),
        };
      }
      return makeCollection(name as keyof typeof stores);
    },
  } as unknown as Db;

  return { db, stores, setGameState: (doc: Record<string, unknown>) => (gameStateDoc = doc) };
}

describe("processAllStateDemographics — durable ('permanent') legislation", () => {
  const durableLaw = {
    _id: "landmark-civil-rights-act",
    demographicEffects: [
      {
        groupId: "rural_traditionalists",
        target: "economicLean",
        direction: 1,
        magnitude: 1,
        permanent: true,
      },
      {
        groupId: "rural_traditionalists",
        target: "socialLean",
        direction: 1,
        magnitude: 1,
        permanent: true,
      },
    ],
  };

  function alDemographics(): StateDemographics {
    return {
      _id: "AL",
      countryId: "US",
      categoryWeights: { voterGroups: 100 },
      groups: {
        rural_traditionalists: {
          population: 30,
          economicLean: -2.0,
          socialLean: -1.5,
          turnout: 60,
        },
      },
      lastUpdated: FIXED_DATE,
    };
  }

  const RURAL_CATEGORY: DemographicCategory = {
    _id: "voterGroups",
    name: "Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "rural_traditionalists",
        name: "Rural Traditionalists",
        defaultEconomicLean: -2.0,
        defaultSocialLean: -1.5,
        defaultTurnout: 60,
      },
    ],
  };

  const activePolicy = {
    _id: "p1",
    stateId: "AL",
    legislationTypeId: "landmark-civil-rights-act",
    economic: 3,
    social: 3,
    effectDirection: 1,
    enactedAt: FIXED_DATE,
    enactedTurn: 1,
    policyOptionId: "opt",
    policyOptionIndex: 6,
  };

  function makeFixture(policies: Array<Record<string, unknown>>) {
    return createPersistingFakeDb({
      states: [{ _id: "AL", countryId: "US" }],
      statePolicies: policies,
      legislationTypes: [durableLaw],
      stateDemographics: [alDemographics()],
      demographicCategories: [RURAL_CATEGORY],
      demographicDefaults: [alDemographics()],
      gameState: { _id: "current", legislationDemographicEffectsV2Enabled: true },
    });
  }

  it("durably relocates the base value on BOTH stateDemographics and demographicDefaults, and it survives repeal without decaying back", async () => {
    const { db, stores } = makeFixture([activePolicy]);

    for (let turn = 0; turn < 60; turn++) {
      await processAllStateDemographics(db);
    }

    const liveAfterActive = (stores.stateDemographics.get("AL") as unknown as StateDemographics)
      .groups.rural_traditionalists.economicLean;
    const defaultsAfterActive = (
      stores.demographicDefaults.get("AL") as unknown as StateDemographics
    ).groups.rural_traditionalists.economicLean;
    // Durably moved rightward (historically-correct direction for a
    // civil-rights-style landmark act's counter-realignment target)...
    expect(liveAfterActive).toBeGreaterThan(-2.0);
    // ...and the seeded baseline moved together — nothing left to decay toward.
    expect(defaultsAfterActive).toBeCloseTo(liveAfterActive, 6);

    // Repeal: the policy row is removed entirely (this fixture's model of
    // "no longer active", matching how `statePolicies` is queried with no
    // status filter).
    stores.statePolicies.clear();

    for (let turn = 0; turn < 40; turn++) {
      await processAllStateDemographics(db);
    }

    const liveAfterRepeal = (stores.stateDemographics.get("AL") as unknown as StateDemographics)
      .groups.rural_traditionalists.economicLean;
    // A TEMPORARY law would have decayed most of the way back toward -2.0 by
    // now (0.25%/turn compounding over 40 turns). A DURABLE one does not:
    // the value the law left behind sticks permanently.
    expect(liveAfterRepeal).toBeCloseTo(liveAfterActive, 6);
  });

  it("is NATIONAL in scope: a federal-scoped durable law moves EVERY state's base value, not just one", async () => {
    // stateId: "federal" is processAllStateDemographics's existing national-
    // scope convention (see getFederalMultiplier("US") = 1/50) — a durable
    // effect authored on a federal bill reaches every state through the SAME
    // scope-multiplier machinery ordinary (temporary) legislation already
    // uses, no new plumbing required for national reach.
    const federalDurableLaw = {
      _id: "landmark-federal-civil-rights-act",
      demographicEffects: [
        {
          groupId: "rural_traditionalists",
          target: "economicLean",
          direction: 1,
          magnitude: 3,
          permanent: true,
        },
      ],
    };
    const federalPolicy = {
      _id: "p-federal",
      stateId: "federal",
      legislationTypeId: "landmark-federal-civil-rights-act",
      economic: 3,
      social: 0,
      effectDirection: 1,
      enactedAt: FIXED_DATE,
      enactedTurn: 1,
      policyOptionId: "opt",
      policyOptionIndex: 6,
    };
    // Three states spanning different regions — none special-cased.
    const stateIds = ["AL", "CA", "NY"];
    const { db, stores } = createPersistingFakeDb({
      states: stateIds.map((s) => ({ _id: s, countryId: "US" })),
      statePolicies: [federalPolicy],
      legislationTypes: [federalDurableLaw],
      stateDemographics: stateIds.map((s) => ({ ...alDemographics(), _id: s })),
      demographicCategories: [RURAL_CATEGORY],
      demographicDefaults: stateIds.map((s) => ({ ...alDemographics(), _id: s })),
      gameState: { _id: "current", legislationDemographicEffectsV2Enabled: true },
    });

    for (let turn = 0; turn < 300; turn++) {
      await processAllStateDemographics(db);
    }

    const values = stateIds.map(
      (s) =>
        (stores.stateDemographics.get(s) as unknown as StateDemographics).groups
          .rural_traditionalists.economicLean
    );
    // Every state moved rightward from the -2.0 starting point...
    for (const [i, v] of values.entries()) {
      expect(v, `${stateIds[i]} did not move`).toBeGreaterThan(-2.0);
    }
    // ...by the SAME amount (federal dilution applies identically everywhere
    // — this is what "national, not one state" means structurally).
    expect(values[1]).toBeCloseTo(values[0], 9);
    expect(values[2]).toBeCloseTo(values[0], 9);

    // And the seeded baseline moved together in every state too (durable,
    // not a decaying overlay) — spot-check one.
    const nyDefaults = (stores.demographicDefaults.get("NY") as unknown as StateDemographics).groups
      .rural_traditionalists.economicLean;
    expect(nyDefaults).toBeCloseTo(values[2], 6);
  });

  it("is beatable: a sustained, stronger opposing durable law reverses the relocation", async () => {
    const opposingDurableLaw = {
      _id: "opposing-durable-law",
      demographicEffects: [
        {
          groupId: "rural_traditionalists",
          target: "economicLean",
          direction: -1,
          magnitude: 3,
          permanent: true,
        },
      ],
    };
    const opposingPolicy = {
      _id: "p2",
      stateId: "AL",
      legislationTypeId: "opposing-durable-law",
      economic: 3,
      social: 0,
      effectDirection: -1,
      enactedAt: FIXED_DATE,
      enactedTurn: 1,
      policyOptionId: "opt",
      policyOptionIndex: 0,
    };
    const { db, stores } = createPersistingFakeDb({
      states: [{ _id: "AL", countryId: "US" }],
      statePolicies: [activePolicy, opposingPolicy],
      legislationTypes: [durableLaw, opposingDurableLaw],
      stateDemographics: [alDemographics()],
      demographicCategories: [RURAL_CATEGORY],
      demographicDefaults: [alDemographics()],
      gameState: { _id: "current", legislationDemographicEffectsV2Enabled: true },
    });

    for (let turn = 0; turn < 60; turn++) {
      await processAllStateDemographics(db);
    }

    const live = (stores.stateDemographics.get("AL") as unknown as StateDemographics).groups
      .rural_traditionalists.economicLean;
    // magnitude-3 opposing law beats the magnitude-1 landmark law: held at
    // (or past) the starting position instead of drifting right.
    expect(live).toBeLessThanOrEqual(-2.0);
  });

  it("reaches the GRANULAR vote path: a durable law permanently shifts AL's granular-cell electorate and a matching candidate's vote share", async () => {
    function makeGranularCandidate(
      id: string,
      party: string,
      ep: number,
      sp: number
    ): EnrichedCandidate {
      return {
        candidateId: id,
        characterId: `${id}_char`,
        characterName: id,
        party,
        isNPP: false,
        charEP: ep,
        charSP: sp,
        favorability: 55,
        politicalInfluence: 60,
        nationalInfluence: 50,
      };
    }

    const alPristine = alDemographics();
    const { db, stores } = makeFixture([activePolicy]);

    for (let turn = 0; turn < 80; turn++) {
      await processAllStateDemographics(db);
    }

    const alDefaultsAfter = stores.demographicDefaults.get("AL") as unknown as StateDemographics;
    expect(alDefaultsAfter.layer1PositionOverrides).toBeDefined();

    const enriched = [
      makeGranularCandidate("dem", "democrat", -2, -2),
      makeGranularCandidate("rep", "republican", 2, 2),
    ];

    // Isolation (same technique as eraCheckpointTurn.test.ts's granular
    // acceptance test): `demographics` passed as the SAME object as
    // `demographicDefaults` on both sides pins the pre-existing
    // legislation lean-DELTA fold (live − defaults) at zero, so any measured
    // difference is attributable ONLY to the NEW durable
    // `layer1PositionOverrides` channel.
    clearGranularElectorateCache();
    const before = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alPristine,
      categories: [],
      enriched,
      demographicDefaults: alPristine,
    })!;
    clearGranularElectorateCache();
    const after = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alDefaultsAfter,
      categories: [],
      enriched,
      demographicDefaults: alDefaultsAfter,
    })!;
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();

    const weightedMean = (units: typeof before.units) => {
      let w = 0;
      let e = 0;
      for (const u of units) {
        w += u.share;
        e += u.share * u.economicLean;
      }
      return e / w;
    };
    expect(weightedMean(after.units)).toBeGreaterThan(weightedMean(before.units));

    const shares = (s: typeof before) =>
      distributeVotesByGroupLevelAllocation(
        s.enriched,
        s.totalPool,
        s.totalPool,
        1_000_000,
        s.demographics,
        s.categories,
        new Map(),
        { isGeneralElection: true, countryId: "US", liveTurnouts: s.liveTurnouts }
      ).sharesPct;

    const beforeShares = shares(before);
    const afterShares = shares(after);
    // Same two candidates, same positions, same census — the ONLY thing that
    // changed is the durable law's accumulated overlay. This is the granular
    // (`granularElectorateEnabled`) substrate specifically — proving the
    // designated-legislation channel reaches an actual vote outcome there,
    // not just a stored archetype field.
    expect(afterShares["rep"]).toBeGreaterThan(beforeShares["rep"]);
    expect(afterShares["dem"]).toBeLessThan(beforeShares["dem"]);
  });
});

// ─── Durable ("permanent") TURNOUT — the Voting Rights Act worked example ───
//
// Mirrors the lean describe block above exactly (durable relocation survives
// repeal, national scope, beatable, reaches the granular vote path) but for
// `target: "turnout"` — the channel modeling ENFRANCHISEMENT (a group that
// could not previously vote gaining the ballot), not a lean shift among
// voters who already could. See `DemographicEffect.permanent`'s doc comment
// in `src/lib/db/types/legislation.ts` and the module doc on
// `src/lib/demographics/durableRealignment.ts`.

describe("processAllStateDemographics — durable ('permanent') TURNOUT (Voting Rights Act worked example)", () => {
  const durableTurnoutLaw = {
    _id: "landmark-voting-rights-act",
    demographicEffects: [
      {
        groupId: "union_trades",
        target: "turnout",
        direction: 1,
        magnitude: 1,
        permanent: true,
      },
    ],
  };

  // union_trades is the 1953-preset archetype carrying the race:black
  // Layer-1 weight (see `ARCHETYPE_BUCKET_MAP` / `SOUTHERN_REALIGNMENT_CHECKPOINT`'s
  // doc comment) — the same archetype-proxy convention this project already
  // uses for Black-voter-targeted checkpoints, reused here for the
  // legislation channel's worked example.
  function alTurnoutDemographics(): StateDemographics {
    return {
      _id: "AL",
      countryId: "US",
      categoryWeights: { voterGroups: 100 },
      groups: {
        union_trades: { population: 25, economicLean: -3, socialLean: -1.5, turnout: 40 },
      },
      lastUpdated: FIXED_DATE,
    };
  }

  const UNION_TRADES_CATEGORY: DemographicCategory = {
    _id: "voterGroups",
    name: "Voter Groups",
    defaultWeight: 100,
    groups: [
      {
        id: "union_trades",
        name: "Union & Trades",
        defaultEconomicLean: -3,
        defaultSocialLean: -1.5,
        defaultTurnout: 40,
      },
    ],
  };

  const activeTurnoutPolicy = {
    _id: "p1",
    stateId: "AL",
    legislationTypeId: "landmark-voting-rights-act",
    economic: 3,
    social: 0,
    effectDirection: 1,
    enactedAt: FIXED_DATE,
    enactedTurn: 1,
    policyOptionId: "opt",
    policyOptionIndex: 6,
  };

  function makeTurnoutFixture(policies: Array<Record<string, unknown>>) {
    return createPersistingFakeDb({
      states: [{ _id: "AL", countryId: "US" }],
      statePolicies: policies,
      legislationTypes: [durableTurnoutLaw],
      stateDemographics: [alTurnoutDemographics()],
      demographicCategories: [UNION_TRADES_CATEGORY],
      demographicDefaults: [alTurnoutDemographics()],
      gameState: { _id: "current", legislationDemographicEffectsV2Enabled: true },
    });
  }

  it("durably relocates turnout on BOTH stateDemographics and demographicDefaults, and it survives repeal without decaying back", async () => {
    const { db, stores } = makeTurnoutFixture([activeTurnoutPolicy]);

    for (let turn = 0; turn < 60; turn++) {
      await processAllStateDemographics(db);
    }

    const liveAfterActive = (stores.stateDemographics.get("AL") as unknown as StateDemographics)
      .groups.union_trades.turnout!;
    const defaultsAfterActive = (
      stores.demographicDefaults.get("AL") as unknown as StateDemographics
    ).groups.union_trades.turnout!;
    // Durably moved turnout UP (enfranchisement)...
    expect(liveAfterActive).toBeGreaterThan(40);
    // ...and the seeded baseline moved together — nothing left to decay toward.
    expect(defaultsAfterActive).toBeCloseTo(liveAfterActive, 6);

    // Repeal: the policy row is removed entirely.
    stores.statePolicies.clear();

    for (let turn = 0; turn < 40; turn++) {
      await processAllStateDemographics(db);
    }

    const liveAfterRepeal = (stores.stateDemographics.get("AL") as unknown as StateDemographics)
      .groups.union_trades.turnout!;
    // A TEMPORARY turnout effect would have decayed most of the way back
    // toward 40 by now. A DURABLE one does not: the enfranchisement sticks.
    expect(liveAfterRepeal).toBeCloseTo(liveAfterActive, 6);
  });

  it("is beatable: a sustained, stronger opposing durable turnout law (voter suppression) reverses the relocation", async () => {
    const opposingSuppressionLaw = {
      _id: "opposing-suppression-law",
      demographicEffects: [
        {
          groupId: "union_trades",
          target: "turnout",
          direction: -1,
          magnitude: 3,
          permanent: true,
        },
      ],
    };
    const opposingPolicy = {
      _id: "p2",
      stateId: "AL",
      legislationTypeId: "opposing-suppression-law",
      economic: 3,
      social: 0,
      effectDirection: -1,
      enactedAt: FIXED_DATE,
      enactedTurn: 1,
      policyOptionId: "opt",
      policyOptionIndex: 0,
    };
    const { db, stores } = createPersistingFakeDb({
      states: [{ _id: "AL", countryId: "US" }],
      statePolicies: [activeTurnoutPolicy, opposingPolicy],
      legislationTypes: [durableTurnoutLaw, opposingSuppressionLaw],
      stateDemographics: [alTurnoutDemographics()],
      demographicCategories: [UNION_TRADES_CATEGORY],
      demographicDefaults: [alTurnoutDemographics()],
      gameState: { _id: "current", legislationDemographicEffectsV2Enabled: true },
    });

    for (let turn = 0; turn < 60; turn++) {
      await processAllStateDemographics(db);
    }

    const live = (stores.stateDemographics.get("AL") as unknown as StateDemographics).groups
      .union_trades.turnout;
    // magnitude-3 suppression law beats the magnitude-1 enfranchisement law:
    // held at (or below) the starting turnout instead of rising.
    expect(live).toBeLessThanOrEqual(40);
  });

  it("reaches the GRANULAR vote path: a durable turnout law permanently raises AL's granular-cell turnout and shifts vote share toward the favored candidate", async () => {
    function makeGranularCandidate(
      id: string,
      party: string,
      ep: number,
      sp: number
    ): EnrichedCandidate {
      return {
        candidateId: id,
        characterId: `${id}_char`,
        characterName: id,
        party,
        isNPP: false,
        charEP: ep,
        charSP: sp,
        favorability: 55,
        politicalInfluence: 60,
        nationalInfluence: 50,
      };
    }

    // A SEPARATE, never-mutated reference for the "before" baseline — the
    // fixture fed to the fake DB below must NOT be the same object, since its
    // `bulkWrite` mutates fixture documents in place (same aliasing hazard
    // the lean acceptance test above avoids by calling `alDemographics()`
    // fresh for the fixture instead of reusing `alPristine`).
    const alPristine = alTurnoutDemographics();
    // A stronger (magnitude 3) law over more turns so the accumulated
    // race:black bucket-rate overlay is large enough to be unambiguously
    // measurable in the derived cells and the resulting vote shares.
    const strongLaw = {
      _id: "landmark-voting-rights-act-strong",
      demographicEffects: [
        { groupId: "union_trades", target: "turnout", direction: 1, magnitude: 3, permanent: true },
      ],
    };
    const strongPolicy = {
      ...activeTurnoutPolicy,
      legislationTypeId: "landmark-voting-rights-act-strong",
    };
    const { db, stores } = createPersistingFakeDb({
      states: [{ _id: "AL", countryId: "US" }],
      statePolicies: [strongPolicy],
      legislationTypes: [strongLaw],
      stateDemographics: [alTurnoutDemographics()],
      demographicCategories: [UNION_TRADES_CATEGORY],
      demographicDefaults: [alTurnoutDemographics()],
      gameState: { _id: "current", legislationDemographicEffectsV2Enabled: true },
    });

    for (let turn = 0; turn < 150; turn++) {
      await processAllStateDemographics(db);
    }

    const alDefaultsAfter = stores.demographicDefaults.get("AL") as unknown as StateDemographics;
    expect(alDefaultsAfter.layer1TurnoutOverrides).toBeDefined();
    expect(alDefaultsAfter.layer1TurnoutOverrides?.race?.black).toBeGreaterThan(0);

    // Isolation (same technique as the lean acceptance test above):
    // `demographics` passed as the SAME object as `demographicDefaults` on
    // both sides pins the pre-existing legislation lean-DELTA fold at zero,
    // so any measured difference is attributable ONLY to the NEW durable
    // `layer1TurnoutOverrides` channel.
    clearGranularElectorateCache();
    const before = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alPristine,
      categories: [],
      enriched: [],
      demographicDefaults: alPristine,
    })!;
    expect(before).not.toBeNull();

    clearGranularElectorateCache();
    const after = buildGranularElectorateSubstrate({
      countryId: "US",
      stateId: "AL",
      preset: "1953-default",
      turnoutDoc: null,
      statePopulation: 1_000_000,
      demographics: alDefaultsAfter,
      categories: [],
      enriched: [],
      demographicDefaults: alDefaultsAfter,
    })!;
    expect(after).not.toBeNull();

    // The durable shift raises turnout specifically for race:black-carrying
    // units (bucket-weighted, robust to unit repartitioning across the two
    // derivations).
    const blackWeighted = (units: typeof before.units) => {
      let w = 0;
      let t = 0;
      let e = 0;
      let s = 0;
      for (const u of units) {
        const bw = u.bucketWeights["race:black"] ?? 0;
        if (bw <= 0) continue;
        w += u.share * bw;
        t += u.share * bw * u.turnout;
        e += u.share * bw * u.economicLean;
        s += u.share * bw * u.socialLean;
      }
      return { turnout: t / w, economicLean: e / w, socialLean: s / w };
    };
    const beforeBlack = blackWeighted(before.units);
    const afterBlack = blackWeighted(after.units);
    expect(afterBlack.turnout).toBeGreaterThan(beforeBlack.turnout);

    // Two fixed candidates (same technique as the lean test): whichever one
    // sits on the SAME side of the origin as the race:black bucket's own
    // (pre-existing, unmoved) lean is the one enfranchisement should help —
    // determined dynamically from the data rather than hard-coded, since this
    // test does not assume a particular real-world political direction.
    const favoredId = beforeBlack.economicLean + beforeBlack.socialLean < 0 ? "dem" : "rep";
    const enriched = [
      makeGranularCandidate("dem", "democrat", -2, -2),
      makeGranularCandidate("rep", "republican", 2, 2),
    ];

    const shares = (s: typeof before) =>
      distributeVotesByGroupLevelAllocation(
        enriched,
        s.totalPool,
        s.totalPool,
        1_000_000,
        s.demographics,
        s.categories,
        new Map(),
        { isGeneralElection: true, countryId: "US", liveTurnouts: s.liveTurnouts }
      ).sharesPct;

    const beforeShares = shares(before);
    const afterShares = shares(after);
    // Same two candidates, same positions, same census — the ONLY thing that
    // changed is the durable TURNOUT law's accumulated overlay. This proves
    // the enfranchisement channel reaches an actual vote outcome on the
    // granular (`granularElectorateEnabled`) substrate, not just a stored
    // archetype field.
    expect(afterShares[favoredId]).toBeGreaterThan(beforeShares[favoredId]);
  });
});
