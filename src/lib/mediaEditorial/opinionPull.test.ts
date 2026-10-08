import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types/demographics";
import { buildDemographicUpdates, processAllStateDemographics } from "@/lib/demographicEffects";
import {
  MEDIA_PULL_AXIS_SPAN,
  MEDIA_PULL_MAX_STEP_PER_TURN,
  MEDIA_PULL_WINDOW_TURNS,
  loadAllStateSlants,
  mediaPullForState,
  mediaPullStep,
} from "./opinionPull";

const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function demographics(overrides?: Partial<StateDemographics>): StateDemographics {
  return {
    _id: "PA",
    countryId: "US",
    categoryWeights: { voterGroups: 100 },
    groups: {
      a: { population: 20, economicLean: -3, socialLean: -1, turnout: 60 },
      b: { population: 20, economicLean: 3, socialLean: 1, turnout: 60 },
    },
    lastUpdated: FIXED_DATE,
    ...overrides,
  };
}

const CATEGORY: DemographicCategory = {
  _id: "voterGroups",
  name: "Voter Groups",
  defaultWeight: 100,
  groups: [
    { id: "a", name: "A", defaultEconomicLean: -3, defaultSocialLean: -1, defaultTurnout: 60 },
    { id: "b", name: "B", defaultEconomicLean: 3, defaultSocialLean: 1, defaultTurnout: 60 },
  ],
};

const EMPTY_SHIFTS = { population: {}, economicLean: {}, socialLean: {}, turnout: {} };
const BASELINES = new Map([
  ["a", { economicLean: -3, socialLean: -1, turnout: 60 }],
  ["b", { economicLean: 3, socialLean: 1, turnout: 60 }],
]);

describe("mediaPullStep", () => {
  it("max per-turn step times the window equals half an axis point", () => {
    expect(MEDIA_PULL_MAX_STEP_PER_TURN * MEDIA_PULL_WINDOW_TURNS).toBeCloseTo(0.5, 12);
  });

  it("at full saturation and maximum distance the step is the ceiling, so 72 turns move at most 0.5", () => {
    const step = mediaPullStep(-5, 5, 1);
    expect(step).toBeCloseTo(MEDIA_PULL_MAX_STEP_PER_TURN, 12);
    let lean = -5;
    for (let i = 0; i < MEDIA_PULL_WINDOW_TURNS; i++) lean += mediaPullStep(lean, 5, 1);
    // The step shrinks as the gap closes, so the total stays under the bound.
    expect(lean - -5).toBeLessThanOrEqual(0.5);
    expect(lean - -5).toBeGreaterThan(0.45);
  });

  it("is zero with no saturation or no distance", () => {
    expect(mediaPullStep(1, 4, 0)).toBe(0);
    expect(mediaPullStep(2, 2, 1)).toBe(0);
    expect(mediaPullStep(Number.NaN, 2, 1)).toBe(0);
  });

  it("moves toward the target in both directions", () => {
    expect(mediaPullStep(0, 4, 1)).toBeGreaterThan(0);
    expect(mediaPullStep(0, -4, 1)).toBeLessThan(0);
  });

  it("scales with saturation and with distance", () => {
    expect(mediaPullStep(0, 4, 0.5)).toBeCloseTo(mediaPullStep(0, 4, 1) / 2, 12);
    expect(mediaPullStep(0, 4, 1)).toBeCloseTo(mediaPullStep(0, 2, 1) * 2, 12);
    expect(MEDIA_PULL_AXIS_SPAN).toBe(10);
  });

  it("never overshoots the slant, even with the step larger than a tiny gap", () => {
    for (const gap of [1e-9, 1e-5, 0.001]) {
      expect(Math.abs(mediaPullStep(0, gap, 1))).toBeLessThanOrEqual(gap);
      expect(Math.abs(mediaPullStep(0, -gap, 1))).toBeLessThanOrEqual(gap);
    }
    let lean = 0;
    for (let i = 0; i < 100000; i++) lean += mediaPullStep(lean, 0.3, 1);
    expect(lean).toBeLessThanOrEqual(0.3);
  });
});

describe("mediaPullForState", () => {
  it("is zero when no newsroom takes a stance", () => {
    expect(mediaPullForState({ economic: 1, social: 1 }, null)).toEqual({ economic: 0, social: 0 });
  });
  it("pulls each axis toward its own slant", () => {
    const pull = mediaPullForState(
      { economic: 0, social: 0 },
      { economic: 4, social: -3, strength: 1 }
    );
    expect(pull.economic).toBeGreaterThan(0);
    expect(pull.social).toBeLessThan(0);
  });
});

describe("buildDemographicUpdates with a media pull", () => {
  it("adds the step to every group on that axis and leaves other axes alone", () => {
    const updates = buildDemographicUpdates(demographics(), EMPTY_SHIFTS, BASELINES, true, {
      economic: 0.005,
      social: 0,
    });
    expect(updates["groups.a.economicLean"]).toBeCloseTo(-2.995, 9);
    expect(updates["groups.b.economicLean"]).toBeCloseTo(3.005, 9);
    expect(updates["groups.a.socialLean"]).toBeUndefined();
  });

  it("is a no-op without a pull, and keeps baseline mean reversion running", () => {
    const off = buildDemographicUpdates(demographics(), EMPTY_SHIFTS, BASELINES, true, null);
    expect(off).toEqual({});
    const drifted = demographics({
      groups: {
        a: { population: 20, economicLean: -2, socialLean: -1, turnout: 60 },
        b: { population: 20, economicLean: 3, socialLean: 1, turnout: 60 },
      },
    });
    const reverting = buildDemographicUpdates(drifted, EMPTY_SHIFTS, BASELINES, true, null);
    const withPull = buildDemographicUpdates(drifted, EMPTY_SHIFTS, BASELINES, true, {
      economic: 0.005,
      social: 0,
    });
    // Same mean reversion, plus the pull on top.
    expect(withPull["groups.a.economicLean"]).toBeCloseTo(
      (reverting["groups.a.economicLean"] ?? -2) + 0.005,
      9
    );
  });
});

describe("loadAllStateSlants", () => {
  it("builds every state's slant from two reads", async () => {
    const db = createMockDb();
    const cursorOf = (docs: unknown[]) => ({
      toArray: vi.fn().mockResolvedValue(docs),
      project: vi.fn().mockReturnThis(),
    });
    db.collection("corporateSectors");
    db.collection("corporations");
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      cursorOf([
        { corporationId: "c1", stateId: "PA", realizedRevenue: 100 },
        { corporationId: "c2", stateId: "PA", realizedRevenue: 100 },
        { corporationId: "c2", stateId: "OH", realizedRevenue: 50 },
        { corporationId: "c3", stateId: "TX", realizedRevenue: 50 },
      ])
    );
    db.collectionMocks.corporations!.find.mockReturnValue(
      cursorOf([
        { _id: "c1", editorialStance: { economic: 4, social: 2 } },
        { _id: "c2" },
        { _id: "c3", editorialStance: { economic: 0, social: 0 } },
      ])
    );
    const slants = await loadAllStateSlants(db as unknown as Db);
    expect(db.collectionMocks.corporateSectors!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporations!.find).toHaveBeenCalledTimes(1);
    expect(slants.get("PA")).toEqual({ economic: 4, social: 2, strength: 0.5 });
    expect(slants.has("OH")).toBe(false);
    expect(slants.has("TX")).toBe(false);
  });
});

describe("processAllStateDemographics media pull", () => {
  let db: MockDb;
  const cursorOf = (docs: unknown[]) => ({
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
  });

  function seed(opts: { flag: boolean; stored?: StateDemographics["mediaOpinionPull"] }) {
    db = createMockDb();
    for (const n of [
      "states",
      "statePolicies",
      "legislationTypes",
      "stateDemographics",
      "gameState",
      "gameConfig",
      "demographicCategories",
      "demographicDefaults",
      "corporateSectors",
      "corporations",
    ]) {
      db.collection(n);
    }
    db.collectionMocks.states!.find.mockReturnValue(cursorOf([{ _id: "PA", countryId: "US" }]));
    db.collectionMocks.statePolicies!.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.legislationTypes!.find.mockReturnValue(cursorOf([]));
    db.collectionMocks.stateDemographics!.find.mockReturnValue(
      cursorOf([
        demographics({ cachedEconomicLean: 0, cachedSocialLean: 0, mediaOpinionPull: opts.stored }),
      ])
    );
    db.collectionMocks.gameState!.findOne.mockResolvedValue({
      _id: "current",
      legislationDemographicEffectsV2Enabled: true,
    });
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ mediaEditorialEnabled: opts.flag });
    db.collectionMocks.demographicCategories!.find.mockReturnValue(cursorOf([CATEGORY]));
    db.collectionMocks.demographicDefaults!.find.mockReturnValue(cursorOf([demographics()]));
    db.collectionMocks.corporateSectors!.find.mockReturnValue(
      cursorOf([{ corporationId: "c1", stateId: "PA", realizedRevenue: 100 }])
    );
    db.collectionMocks.corporations!.find.mockReturnValue(
      cursorOf([{ _id: "c1", editorialStance: { economic: 5, social: 0 } }])
    );
  }

  function written(): Record<string, unknown> | null {
    const bulk = db.collectionMocks.stateDemographics!.bulkWrite;
    if (!bulk.mock.calls.length) return null;
    return (
      bulk.mock.calls[0][0] as Array<{ updateOne: { update: { $set: Record<string, unknown> } } }>
    )[0].updateOne.update.$set;
  }

  beforeEach(() => vi.clearAllMocks());

  it("pulls toward the slant, stamps the watermark, and issues batched reads only", async () => {
    seed({ flag: true });
    await processAllStateDemographics(db as unknown as Db, [], 100);
    const set = written()!;
    expect(set["groups.a.economicLean"]).toBeCloseTo(-3 + mediaPullStep(0, 5, 1), 9);
    expect(set["mediaOpinionPull.turn"]).toBe(100);
    expect(set["mediaOpinionPull.strength"]).toBe(1);
    expect(db.collectionMocks.corporateSectors!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporations!.find).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: the same turn does not pull twice", async () => {
    seed({
      flag: true,
      stored: { turn: 100, economic: 0.005, social: 0, strength: 1 },
    });
    await processAllStateDemographics(db as unknown as Db, [], 100);
    expect(written()).toBeNull();
  });

  it("does nothing with the media editorial flag off", async () => {
    seed({ flag: false });
    await processAllStateDemographics(db as unknown as Db, [], 100);
    expect(written()).toBeNull();
    expect(db.collectionMocks.corporateSectors!.find).not.toHaveBeenCalled();
  });

  it("does nothing when no newsroom takes a stance", async () => {
    seed({ flag: true });
    db.collectionMocks.corporations!.find.mockReturnValue(
      cursorOf([{ _id: "c1", editorialStance: { economic: 0, social: 0 } }])
    );
    await processAllStateDemographics(db as unknown as Db, [], 100);
    expect(written()).toBeNull();
  });
});
