import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Crisis } from "@/lib/db/types/crisis";
import { getMetricDefinition } from "@/lib/constants/metricDefinitions";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/wireEvent", () => ({ logWireEvent: vi.fn().mockResolvedValue(undefined) }));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  // Pre-seed collections so collectionMocks[name] exists before tests set up mocks
  ["crises", "states", "stateMetrics", "governmentApprovals", "corporateSectors"].forEach((name) =>
    db.collection(name)
  );
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  vi.clearAllMocks();
});

function makeCrisis(overrides: Partial<Crisis> = {}): Crisis {
  return {
    _id: new ObjectId(),
    name: "Test Crisis",
    description: "desc",
    scope: "global",
    countryIds: [],
    regionIds: [],
    status: "active",
    startTurn: 10,
    endTurn: null,
    durationTurns: null,
    effects: [],
    wireMessageOnStart: "Crisis begins",
    wireMessageOnEnd: null,
    createdBy: new ObjectId(),
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

describe("processCrisisTurn", () => {
  it("returns 0 and does nothing when no active crises", async () => {
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [] });

    const { processCrisisTurn } = await import("./crisisTurn");
    const result = await processCrisisTurn(db as unknown as Db, 10);

    expect(result).toBe(0);
    expect(db.collectionMocks.stateMetrics?.updateMany).not.toHaveBeenCalled();
  });

  it("applies tick metric effect every turn", async () => {
    const crisis = makeCrisis({
      scope: "global",
      startTurn: 5,
      effects: [
        {
          effectType: "tick",
          targetType: "metric",
          metricCategory: "economic",
          metricField: "unemploymentRate",
          sectorType: null,
          strategyId: null,
          value: 0.5,
          label: "Unemployment tick",
        },
      ],
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [
        { _id: "CA", countryId: "US" },
        { _id: "TX", countryId: "US" },
      ],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 10);

    // SP5: economic effects land on macroMetrics for every target region.
    // S8: pipeline update clamped to the metricDefinitions bounds ([1, 25]).
    // The floor was 2 until the 1953 era-band sweep: post-war reconstruction
    // Europe ran genuinely tighter labour markets than the modern floor assumed
    // (France's authored 1953 Île-de-France unemployment is 1.5).
    expect(db.collectionMocks.macroMetrics.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["CA", "TX"] } },
      [
        {
          $set: expect.objectContaining({
            "economic.unemploymentRate.value": {
              $max: [
                1,
                {
                  $min: [25, { $add: [{ $ifNull: ["$economic.unemploymentRate.value", 0] }, 0.5] }],
                },
              ],
            },
          }),
        },
      ]
    );
    expect(db.collectionMocks.macroMetrics.updateMany).toHaveBeenCalledTimes(1);
  });

  it("applies flat metric effect only on startTurn, not on subsequent turns", async () => {
    const crisis = makeCrisis({
      startTurn: 10,
      effects: [
        {
          effectType: "flat",
          targetType: "metric",
          // A MACRO path: the subject here is the flat-vs-tick TIMING, and the
          // political half is no longer written for any board country, so a
          // political path would make the timing unobservable.
          metricCategory: "economic",
          metricField: "unemploymentRate",
          sectorType: null,
          strategyId: null,
          value: -5,
          label: "Unemployment hit",
        },
      ],
    });
    // Exercised on a JP region: every country is a board country now, so the
    // effect has to target a macro path to land anywhere at all.
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ _id: "TOK", countryId: "JP" }],
    });

    const { processCrisisTurn } = await import("./crisisTurn");

    // On startTurn — should apply
    await processCrisisTurn(db as unknown as Db, 10);
    expect(db.collectionMocks.macroMetrics.updateMany).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ _id: "TOK", countryId: "JP" }],
    });

    // On turn 11 — should NOT apply (flat, already fired)
    await processCrisisTurn(db as unknown as Db, 11);
    expect(db.collectionMocks.macroMetrics?.updateMany).not.toHaveBeenCalled();
  });

  it("auto-resolves crisis when durationTurns is exceeded", async () => {
    const id = new ObjectId();
    const crisis = makeCrisis({
      _id: id,
      startTurn: 5,
      durationTurns: 3, // expires at turn 5 + 3 = 8
      effects: [],
      wireMessageOnEnd: "Crisis over",
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({ toArray: async () => [] });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 8);

    expect(db.collectionMocks.crises.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [id] } },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "resolved", endTurn: 8 }),
      })
    );

    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(logWireEvent).toHaveBeenCalledWith("crisis_end", "Crisis over", expect.any(Object));
  });

  it("does not auto-resolve indefinite crisis", async () => {
    const crisis = makeCrisis({ startTurn: 1, durationTurns: null, effects: [] });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({ toArray: async () => [] });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 999);

    expect(db.collectionMocks.crises.updateMany).not.toHaveBeenCalled();
  });

  it("emits start wire event on startTurn", async () => {
    const crisis = makeCrisis({
      startTurn: 10,
      effects: [],
      wireMessageOnStart: "Crisis starts!",
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({ toArray: async () => [] });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 10);

    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(logWireEvent).toHaveBeenCalledWith(
      "crisis_start",
      "Crisis starts!",
      expect.objectContaining({ href: expect.stringContaining("/world/crises/") })
    );
  });

  it("announceCrisisStart fires the wire event for an out-of-band (admin) crisis", async () => {
    // Admin-created crises never hit the `turn === startTurn` branch, so the
    // announcement has to run at creation via this exported helper.
    const crisis = makeCrisis({ startTurn: 5, effects: [], wireMessageOnStart: "Admin crisis!" });

    const { announceCrisisStart } = await import("./crisisTurn");
    await announceCrisisStart(db as unknown as Db, crisis, ["state-1"]);

    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(logWireEvent).toHaveBeenCalledWith(
      "crisis_start",
      "Admin crisis!",
      expect.objectContaining({ href: expect.stringContaining("/world/crises/") })
    );
  });

  it("does not emit start wire event on turns after startTurn", async () => {
    const crisis = makeCrisis({ startTurn: 10, effects: [], wireMessageOnStart: "Crisis!" });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({ toArray: async () => [] });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 11);

    const { logWireEvent } = await import("@/lib/wireEvent");
    expect(logWireEvent).not.toHaveBeenCalled();
  });

  it("scopes country crisis to regions in specified countries only", async () => {
    const crisis = makeCrisis({
      scope: "country",
      countryIds: ["US" as Crisis["countryIds"][number]],
      effects: [
        {
          effectType: "tick",
          targetType: "metric",
          metricCategory: "economic",
          metricField: "gdpGrowth",
          sectorType: null,
          strategyId: null,
          value: -1,
          label: "GDP drag",
        },
      ],
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [
        { _id: "CA", countryId: "US" },
        { _id: "London", countryId: "UK" }, // should NOT be affected
      ],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 10);

    // SP5: the scoped economic effect lands on macroMetrics.
    expect(db.collectionMocks.macroMetrics.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["CA"] } },
      expect.anything()
    );
    expect(db.collectionMocks.macroMetrics.updateMany).toHaveBeenCalledTimes(1);
  });

  it("tapers a tick effect toward zero over the crisis duration", async () => {
    const crisis = makeCrisis({
      scope: "global",
      startTurn: 0,
      durationTurns: 24,
      effects: [
        {
          effectType: "tick",
          targetType: "metric",
          // A MACRO path: the subject is the TAPER curve, and a political path
          // no longer lands anywhere for a board country.
          metricCategory: "economic",
          metricField: "unemploymentRate",
          sectorType: null,
          strategyId: null,
          value: 0.4,
          label: "Damage accrual",
        },
      ],
    });
    // Every country is a board country now, so the taper has to be observed on
    // a macro path to land at all.
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ _id: "TOK", countryId: "JP" }],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    // Halfway through (turn 12 of 24) the per-turn value is at 50%.
    await processCrisisTurn(db as unknown as Db, 12);

    // S8: pipeline update; halfway taper delta 0.2, clamped to the metric's own
    // [minValue, maxValue], not a blanket 0..100. Read from the DEFINITION
    // rather than hardcoded: the unemployment floor moved 2 -> 1 upstream so it
    // could span every era (1953 France authors 1.5), and a literal here would
    // silently pin this test to whichever era's assumption was current when it
    // was written.
    const unemploymentDef = getMetricDefinition("economic", "unemploymentRate")!;
    expect(db.collectionMocks.macroMetrics.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["TOK"] } },
      [
        {
          $set: expect.objectContaining({
            "economic.unemploymentRate.value": {
              $max: [
                unemploymentDef.minValue,
                {
                  $min: [
                    unemploymentDef.maxValue,
                    {
                      $add: [{ $ifNull: ["$economic.unemploymentRate.value", 0] }, 0.2],
                    },
                  ],
                },
              ],
            },
          }),
        },
      ]
    );
  });

  it("clamps crisis metric shocks to the metric's bounds (S8)", async () => {
    // A -40 shock to unemploymentRate (bounds [1, 25]) must be written as a
    // bounded pipeline expression — never a bare unbounded $inc.
    const crisis = makeCrisis({
      scope: "global",
      startTurn: 10,
      effects: [
        {
          effectType: "flat",
          targetType: "metric",
          metricCategory: "economic",
          metricField: "unemploymentRate",
          sectorType: null,
          strategyId: null,
          value: -40,
          label: "Impossible jobs boom",
        },
      ],
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ _id: "CA", countryId: "US" }],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 10);

    // SP5: economic shocks land on macroMetrics (every target region).
    const [, update] = db.collectionMocks.macroMetrics.updateMany.mock.calls[0];
    // Pipeline form (array), not an operator document with a bare $inc
    expect(Array.isArray(update)).toBe(true);
    const expr = update[0].$set["economic.unemploymentRate.value"];
    expect(expr).toEqual({
      $max: [
        1,
        { $min: [25, { $add: [{ $ifNull: ["$economic.unemploymentRate.value", 0] }, -40] }] },
      ],
    });
    // Evaluate the expression like Mongo would for a current value of 6:
    // 6 + (-40) = -34 → clamped to the floor 1, not persisted out of range.
    expect(Math.max(1, Math.min(25, 6 + -40))).toBe(1);
  });

  it("applies a one-time real GDP loss via $mul on the affected states at startTurn", async () => {
    const crisis = makeCrisis({
      scope: "region",
      regionIds: ["CA"],
      startTurn: 10,
      durationTurns: 24,
      effects: [
        {
          effectType: "flat",
          targetType: "gdpLoss",
          metricCategory: null,
          metricField: null,
          sectorType: null,
          strategyId: null,
          value: 0.25, // 25% of regional GDP destroyed → ×0.75
          label: "Earthquake GDP loss",
        },
      ],
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ _id: "CA", countryId: "US" }],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 10);

    expect(db.collectionMocks.states.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["CA"] } },
      { $mul: { gdp: 0.75 } }
    );
  });

  it("does not re-apply the GDP loss on turns after startTurn", async () => {
    const crisis = makeCrisis({
      scope: "region",
      regionIds: ["CA"],
      startTurn: 10,
      durationTurns: 24,
      effects: [
        {
          effectType: "flat",
          targetType: "gdpLoss",
          metricCategory: null,
          metricField: null,
          sectorType: null,
          strategyId: null,
          value: 0.25,
          label: "Earthquake GDP loss",
        },
      ],
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [{ _id: "CA", countryId: "US" }],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 11);

    expect(db.collectionMocks.states.updateMany).not.toHaveBeenCalled();
  });

  it("applies approval effect to parent country for region-scoped crisis", async () => {
    const crisis = makeCrisis({
      scope: "region",
      regionIds: ["CA", "TX"],
      effects: [
        {
          effectType: "tick",
          targetType: "approval",
          metricCategory: null,
          metricField: null,
          sectorType: null,
          strategyId: null,
          value: -3,
          label: "Approval hit",
        },
      ],
    });
    db.collectionMocks.crises.find.mockReturnValue({ toArray: async () => [crisis] });
    db.collectionMocks.states.find.mockReturnValue({
      toArray: async () => [
        { _id: "CA", countryId: "US" },
        { _id: "TX", countryId: "US" },
        { _id: "London", countryId: "UK" },
      ],
    });

    const { processCrisisTurn } = await import("./crisisTurn");
    await processCrisisTurn(db as unknown as Db, 10);

    // Should hit US exactly once (CA and TX both map to US, deduplicated)
    expect(db.collectionMocks.governmentApprovals.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ["US"] } },
      expect.objectContaining({ $inc: { approvalRating: -3 } })
    );
    expect(db.collectionMocks.governmentApprovals.updateMany).toHaveBeenCalledTimes(1);
  });
});
