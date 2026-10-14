import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb, createAsyncIterableCursor } from "@/lib/test-utils/mockDb";
import type { GoverningAgendaItem } from "../governingAgenda";
import type {
  CabinetPositionMechanics,
  MetricConfig,
  MinisterialOrderConfig,
} from "@/lib/constants/cabinetMechanicsTypes";

const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn() }));
vi.mock("../featureFlag", () => ({ nppAutonomyAtLeast: (...a: unknown[]) => atLeastMock(...a) }));

import {
  scoreLeverAlignment,
  actionBudgetForArchetype,
  planMinisterialActions,
  runMinisterialGovernance,
  ministerShortfall,
  shouldReshuffleMinister,
} from "../ministerialGovernance";

const now = new Date("2026-06-24T12:00:00Z");

// A health minister: a higher-is-better healthcareAccess metric (→ "healthcare").
const healthMetric: MetricConfig = {
  category: "healthcare",
  metricId: "healthcareAccess",
  label: "Healthcare Access",
  format: "percent",
  higherIsBetter: true,
};
const positionMetrics = [healthMetric];

const raiseHealthcare: GoverningAgendaItem = {
  domain: "healthcare",
  target: 65,
  direction: "raise",
  priority: 0.9,
};

describe("scoreLeverAlignment (pure)", () => {
  it("scores a metric-raising effect positively for a raise agenda item", () => {
    const agendaByDomain = new Map([["healthcare", raiseHealthcare]]);
    const score = scoreLeverAlignment(
      [{ metric: "healthcareAccess", modifier: 0.04 }],
      positionMetrics,
      agendaByDomain
    );
    expect(score).toBeGreaterThan(0);
  });

  it("scores a metric-raising effect negatively when the agenda wants it lowered", () => {
    const lower = new Map([["healthcare", { ...raiseHealthcare, direction: "lower" as const }]]);
    const score = scoreLeverAlignment(
      [{ metric: "healthcareAccess", modifier: 0.04 }],
      positionMetrics,
      lower
    );
    expect(score).toBeLessThan(0);
  });

  it("ignores effects on metrics with no agenda item", () => {
    const score = scoreLeverAlignment(
      [{ metric: "healthcareAccess", modifier: 0.04 }],
      positionMetrics,
      new Map()
    );
    expect(score).toBe(0);
  });
});

describe("actionBudgetForArchetype (pure)", () => {
  it("lets ambitious archetypes spend the whole pool, cautious ones keep one back", () => {
    const reformer = { ambition: 80, stubbornness: 20, loyalty: 50 };
    const steward = { ambition: 20, stubbornness: 80, loyalty: 50 };
    expect(actionBudgetForArchetype(reformer, 2)).toBe(2);
    expect(actionBudgetForArchetype(steward, 2)).toBe(1);
    expect(actionBudgetForArchetype(steward, 0)).toBe(0);
  });
});

describe("planMinisterialActions (pure)", () => {
  const tierMechanics: Pick<
    CabinetPositionMechanics,
    "tierSetting" | "nationalMetrics" | "regionalMetrics"
  > = {
    nationalMetrics: positionMetrics,
    regionalMetrics: [],
    tierSetting: {
      name: "Health Funding",
      description: "",
      defaultTier: "standard",
      options: [
        { id: "austere", label: "Austere", description: "", effects: { healthcareAccess: -0.03 } },
        { id: "standard", label: "Standard", description: "", effects: {} },
        {
          id: "expansive",
          label: "Expansive",
          description: "",
          effects: { healthcareAccess: 0.05 },
        },
      ],
    },
  };
  const orders: MinisterialOrderConfig[] = [
    {
      id: "health_drive",
      name: "Health Drive",
      description: "",
      duration: 24,
      effects: [{ metric: "healthcareAccess", modifier: 0.04, scope: "national" }],
    },
    {
      id: "cuts",
      name: "Cuts",
      description: "",
      duration: 24,
      effects: [{ metric: "healthcareAccess", modifier: -0.04, scope: "national" }],
    },
  ];

  it("picks the agenda-advancing tier and order, skipping the harmful one", () => {
    const plan = planMinisterialActions({
      agenda: [raiseHealthcare],
      mechanics: tierMechanics,
      orders,
      personality: { ambition: 80, stubbornness: 20, loyalty: 50 }, // reformer → spends both
      currentTier: "standard",
      activeOrderIds: new Set(),
      actionsAvailable: 2,
    });
    expect(plan.tier).toBe("expansive");
    expect(plan.orderIds).toEqual(["health_drive"]); // only the aligned order
  });

  it("does not re-issue an already-active order, and respects the action budget", () => {
    const plan = planMinisterialActions({
      agenda: [raiseHealthcare],
      mechanics: tierMechanics,
      orders,
      personality: { ambition: 20, stubbornness: 80, loyalty: 50 }, // steward → keeps one back
      currentTier: "expansive", // already best → no tier change
      activeOrderIds: new Set(["health_drive"]),
      actionsAvailable: 2,
    });
    expect(plan.tier).toBeNull();
    expect(plan.orderIds).toEqual([]); // only aligned order already active
  });

  it("target-gates: a raise goal already at/above target is not pursued", () => {
    const plan = planMinisterialActions({
      agenda: [raiseHealthcare], // target 65
      mechanics: tierMechanics,
      orders,
      personality: { ambition: 80, stubbornness: 20, loyalty: 50 }, // reformer
      currentTier: "standard",
      activeOrderIds: new Set(),
      actionsAvailable: 2,
      domainHealth: { healthcare: 80 }, // already above target → satisfied
    });
    expect(plan.tier).toBeNull();
    expect(plan.orderIds).toEqual([]);
  });

  // A "lower" agenda item (comfort/ideology/fiscal-distress driven) must be
  // able to move real ministerial levers toward cutting, not just flip a flag
  // on the agenda item - this is the mechanism that lets a comfortable,
  // surplus-running country's spending actually move.
  const lowerHealthcare: GoverningAgendaItem = {
    domain: "healthcare",
    target: 45,
    direction: "lower",
    priority: 0.9,
  };

  it("a 'lower' agenda item picks the austere tier and the cutting order, not the expansive ones", () => {
    const plan = planMinisterialActions({
      agenda: [lowerHealthcare],
      mechanics: tierMechanics,
      orders,
      personality: { ambition: 80, stubbornness: 20, loyalty: 50 }, // reformer → spends both
      currentTier: "standard",
      activeOrderIds: new Set(),
      actionsAvailable: 2,
    });
    expect(plan.tier).toBe("austere");
    expect(plan.orderIds).toEqual(["cuts"]); // only the aligned (cutting) order
  });

  it("target-gates the lower side too: a domain already at/below its floor is not cut further", () => {
    const plan = planMinisterialActions({
      agenda: [lowerHealthcare], // target 45
      mechanics: tierMechanics,
      orders,
      personality: { ambition: 80, stubbornness: 20, loyalty: 50 },
      currentTier: "standard",
      activeOrderIds: new Set(),
      actionsAvailable: 2,
      domainHealth: { healthcare: 40 }, // already at/below the floor → satisfied
    });
    expect(plan.tier).toBeNull();
    expect(plan.orderIds).toEqual([]);
  });
});

describe("ministerShortfall / shouldReshuffleMinister (pure)", () => {
  const agendaByDomain = new Map([
    ["healthcare", { domain: "healthcare", target: 60, direction: "raise" as const, priority: 1 }],
  ]);

  it("computes the worst shortfall across a minister's agenda domains", () => {
    expect(
      ministerShortfall(new Set(["healthcare"]), agendaByDomain, { healthcare: 30 })
    ).toBeCloseTo(0.5);
    expect(ministerShortfall(new Set(["healthcare"]), agendaByDomain, { healthcare: 60 })).toBe(0);
    // A domain not on the agenda contributes nothing.
    expect(ministerShortfall(new Set(["education"]), agendaByDomain, { education: 10 })).toBe(0);
  });

  it("reshuffles on a big shortfall only when the head is reshuffle-prone enough", () => {
    expect(shouldReshuffleMinister(0.5, 0.6)).toBe(true); // 0.5 > 1-0.6
    expect(shouldReshuffleMinister(0.5, 0.2)).toBe(false); // ideologue tolerates it
    expect(shouldReshuffleMinister(0.2, 0.9)).toBe(false); // below the reshuffle floor
  });
});

let db: MockDb;
const nppId = new ObjectId();

function setup(opts: {
  gov: Record<string, unknown> | null;
  ministers?: Record<string, unknown>[];
  npps?: Record<string, unknown>[];
  /** Head NPP returned by npps.findOne (reshuffle propensity). */
  head?: Record<string, unknown> | null;
  /** National stateMetrics doc returned by stateMetrics.findOne (domain health). */
  stateMetrics?: Record<string, unknown> | null;
}) {
  db = createMockDb();
  db.collectionMocks["governmentFormations"] = {
    ...db.collection("governmentFormations"),
    findOne: vi.fn().mockResolvedValue(opts.gov),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["cabinetMembers"] = {
    ...db.collection("cabinetMembers"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor(opts.ministers ?? [])),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["npps"] = {
    ...db.collection("npps"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor(opts.npps ?? [])),
    findOne: vi.fn().mockResolvedValue(opts.head ?? null),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["stateMetrics"] = {
    ...db.collection("stateMetrics"),
    findOne: vi.fn().mockResolvedValue(opts.stateMetrics ?? null),
  } as MockDb["collectionMocks"][string];
  // IE is a board country since the step-6 cutover, so domain health takes the
  // political branch: ECONOMIC domains read macroMetrics (SP5), political ones
  // read the board. The same fixture feeds both stores so the economic-domain
  // cases stay valid whichever branch a country takes.
  db.collectionMocks["macroMetrics"] = {
    ...db.collection("macroMetrics"),
    findOne: vi.fn().mockResolvedValue(opts.stateMetrics ?? null),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["cabinetSettings"] = {
    ...db.collection("cabinetSettings"),
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  } as MockDb["collectionMocks"][string];
  db.collectionMocks["ministerialOrders"] = {
    ...db.collection("ministerialOrders"),
    find: vi.fn().mockReturnValue(createAsyncIterableCursor([])),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
    insertOne: vi.fn().mockResolvedValue({ insertedId: new ObjectId() }),
  } as MockDb["collectionMocks"][string];
}

beforeEach(() => {
  atLeastMock.mockReset().mockResolvedValue(true);
});

describe("runMinisterialGovernance (I/O)", () => {
  it("no-ops when the v1 gate is not met", async () => {
    atLeastMock.mockResolvedValue(false);
    setup({ gov: { _id: "IE", status: "formed", pmNppId: nppId } });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", 100, now);
    expect(res.ran).toBe(false);
  });

  it("no-ops when there is no agenda yet", async () => {
    setup({ gov: { _id: "IE", status: "formed", pmNppId: nppId, governingAgenda: { items: [] } } });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", 100, now);
    expect(res.ran).toBe(true);
    expect(res.ordersIssued).toBe(0);
  });

  it("issues an aligned order for an NPP minister, spending an action", async () => {
    // IE Taoiseach tracks gdpGrowth (→ economic_growth) and has a real order set;
    // an agenda raising economic_growth should trigger an order.
    setup({
      gov: {
        _id: "IE",
        status: "formed",
        pmNppId: nppId,
        governingAgenda: {
          items: [{ domain: "economic_growth", target: 65, direction: "raise", priority: 1 }],
        },
      },
      ministers: [
        {
          _id: new ObjectId(),
          countryId: "IE",
          positionId: "taoiseach",
          isNPP: true,
          nppId,
          ministerialActions: 2,
        },
      ],
      npps: [{ _id: nppId, personality: { ambition: 80, stubbornness: 20, loyalty: 50 } }],
    });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", 100, now);
    expect(res.ran).toBe(true);
    expect(res.ordersIssued).toBeGreaterThan(0);
    const insertMany = db.collectionMocks["ministerialOrders"].insertMany as ReturnType<
      typeof vi.fn
    >;
    expect(insertMany).toHaveBeenCalledTimes(1);
    const inserted = insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(res.ordersIssued);
    expect(inserted[0].isNPP).toBe(true);
    expect(inserted[0].characterId).toBeNull();
    expect(inserted[0].nppId).toBe(nppId);
    // One guarded spend covers every issued order.
    const spend = db.collectionMocks["cabinetMembers"].updateOne as ReturnType<typeof vi.fn>;
    expect(spend).toHaveBeenCalledTimes(1);
    expect(spend.mock.calls[0][0].ministerialActions).toEqual({ $gte: res.ordersIssued });
    expect(spend.mock.calls[0][1]).toEqual({ $inc: { ministerialActions: -res.ordersIssued } });
  });

  it("falls back to one-action spends when the guarded spend finds the pool short", async () => {
    setup({
      gov: {
        _id: "IE",
        status: "formed",
        pmNppId: nppId,
        governingAgenda: {
          items: [{ domain: "economic_growth", target: 65, direction: "raise", priority: 1 }],
        },
      },
      ministers: [
        {
          _id: new ObjectId(),
          countryId: "IE",
          positionId: "taoiseach",
          isNPP: true,
          nppId,
          ministerialActions: 2,
        },
      ],
      npps: [{ _id: nppId, personality: { ambition: 80, stubbornness: 20, loyalty: 50 } }],
    });
    const spend = db.collectionMocks["cabinetMembers"].updateOne as ReturnType<typeof vi.fn>;
    // Guarded multi-action spend fails, then the pool covers exactly one more action.
    spend
      .mockReset()
      .mockResolvedValueOnce({ modifiedCount: 0 })
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValue({ modifiedCount: 0 });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", 100, now);
    const planned = spend.mock.calls[0][0].ministerialActions.$gte as number;
    expect(spend.mock.calls[0][1]).toEqual({ $inc: { ministerialActions: -planned } });
    // Fallback: one-action spends until the pool runs dry (one succeeds, the
    // next fails, unless the plan only wanted one).
    expect(spend).toHaveBeenCalledTimes(planned > 1 ? 3 : 2);
    expect(spend.mock.calls[1][0].ministerialActions).toEqual({ $gte: 1 });
    expect(res.ordersIssued).toBe(1);
    const insertMany = db.collectionMocks["ministerialOrders"].insertMany as ReturnType<
      typeof vi.fn
    >;
    expect(insertMany.mock.calls[0][0]).toHaveLength(1);
  });

  it("issues nothing when the pool is empty under both spend paths", async () => {
    setup({
      gov: {
        _id: "IE",
        status: "formed",
        pmNppId: nppId,
        governingAgenda: {
          items: [{ domain: "economic_growth", target: 65, direction: "raise", priority: 1 }],
        },
      },
      ministers: [
        {
          _id: new ObjectId(),
          countryId: "IE",
          positionId: "taoiseach",
          isNPP: true,
          nppId,
          ministerialActions: 2,
        },
      ],
      npps: [{ _id: nppId, personality: { ambition: 80, stubbornness: 20, loyalty: 50 } }],
    });
    const spend = db.collectionMocks["cabinetMembers"].updateOne as ReturnType<typeof vi.fn>;
    spend.mockReset().mockResolvedValue({ modifiedCount: 0 });
    const res = await runMinisterialGovernance(db as unknown as Db, "IE", 100, now);
    expect(res.ordersIssued).toBe(0);
    expect(db.collectionMocks["ministerialOrders"].insertMany).not.toHaveBeenCalled();
  });

  it("reads settings and active orders once per country and batches tier writes", async () => {
    setup({
      gov: {
        _id: "UK",
        status: "formed",
        pmNppId: nppId,
        governingAgenda: {
          items: [{ domain: "public_safety", target: 65, direction: "raise", priority: 1 }],
        },
      },
      ministers: [
        {
          _id: new ObjectId(),
          countryId: "UK",
          positionId: "justice_secretary",
          isNPP: true,
          nppId,
          ministerialActions: 0,
        },
        {
          _id: new ObjectId(),
          countryId: "UK",
          positionId: "home_secretary",
          isNPP: true,
          nppId,
          ministerialActions: 0,
        },
      ],
      npps: [{ _id: nppId, personality: { ambition: 80, stubbornness: 20, loyalty: 50 } }],
    });
    const settings = db.collectionMocks["cabinetSettings"];
    // The Home Secretary already stands on the best-aligned tier; the Justice
    // Secretary has no setting row yet.
    settings.find.mockReturnValue(
      createAsyncIterableCursor([
        {
          _id: "UK_home_secretary",
          countryId: "UK",
          positionId: "home_secretary",
          tierSetting: "strict",
          lastChangedTurn: 10,
        },
      ])
    );
    const res = await runMinisterialGovernance(db as unknown as Db, "UK", 100, now);
    expect(settings.find).toHaveBeenCalledTimes(1);
    expect(settings.find.mock.calls[0][0]).toEqual({
      _id: { $in: ["UK_justice_secretary", "UK_home_secretary"] },
    });
    expect(settings.findOne).not.toHaveBeenCalled();
    expect(settings.updateOne).not.toHaveBeenCalled();
    const orderFinds = (
      db.collectionMocks["ministerialOrders"].find as ReturnType<typeof vi.fn>
    ).mock.calls.filter((call) => call[0]?.countryId === "UK");
    expect(orderFinds).toEqual([[{ countryId: "UK", active: true }]]);
    expect(res.tiersSet).toBe(1);
    expect(settings.bulkWrite).toHaveBeenCalledTimes(1);
    const ops = settings.bulkWrite.mock.calls[0][0];
    expect(ops).toEqual([
      {
        updateOne: {
          filter: { _id: "UK_justice_secretary" },
          update: {
            $set: expect.objectContaining({
              positionId: "justice_secretary",
              tierSetting: "strict",
              lastChangedTurn: 100,
              isNPP: true,
              characterId: null,
            }),
          },
          upsert: true,
        },
      },
    ]);
  });

  it("reshuffles a badly-underperforming minister under a reshuffle-prone head", () => {
    const headId = new ObjectId();
    const finMinNppId = new ObjectId();
    setup({
      gov: {
        _id: "IE",
        status: "formed",
        pmNppId: headId,
        governingAgenda: {
          items: [{ domain: "economic_growth", target: 65, direction: "raise", priority: 1 }],
        },
      },
      ministers: [
        {
          _id: new ObjectId(),
          countryId: "IE",
          positionId: "minister_for_finance",
          isNPP: true,
          nppId: finMinNppId,
          ministerialActions: 2,
        },
      ],
      // Reformer head → high reshuffle propensity.
      head: { _id: headId, personality: { ambition: 80, stubbornness: 20, loyalty: 50 } },
      // economic_growth (gdpGrowth) far below the agenda's 65 target → big shortfall.
      stateMetrics: { economic: { gdpGrowth: 10 } },
    });
    return runMinisterialGovernance(db as unknown as Db, "IE", 100, now).then((res) => {
      expect(res.reshuffled).toBe(1);
      const deleteOne = db.collectionMocks["cabinetMembers"].deleteOne as ReturnType<typeof vi.fn>;
      expect(deleteOne).toHaveBeenCalledWith({
        countryId: "IE",
        positionId: "minister_for_finance",
      });
      expect(res.ordersIssued).toBe(0); // vacated minister doesn't also act
    });
  });
});
