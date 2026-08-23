import type { Db } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { RU_LAWS } from "@/lib/politicalLegislation/laws/ruLaws";
import { calculateRuRegionalGrant, processRURegionalBudgets } from "./ruRegionalBudget";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("calculateRuRegionalGrant", () => {
  it("splits the union grants pool population-proportionally", () => {
    expect(
      calculateRuRegionalGrant({
        grantsPool: 60_000_000_000,
        regionPopulation: 20_000_000,
        nationalPopulation: 180_000_000,
      })
    ).toBeCloseTo(6_666_666_666.67, 0);
  });
  it("returns 0 for an empty nation", () => {
    expect(
      calculateRuRegionalGrant({ grantsPool: 1, regionPopulation: 1, nationalPopulation: 0 })
    ).toBe(0);
  });
});

describe("processRURegionalBudgets", () => {
  let db: MockDb;
  const regionLaw = RU_LAWS.find(
    (l) => l.id === "ru.infrastructure.transit.primary" && l.allowedScope === "both"
  )!;

  beforeEach(() => {
    db = createMockDb();
  });

  function wire({
    regions,
    policies,
    budget,
    existingBudgets = [],
  }: {
    regions: unknown[];
    policies: unknown[];
    budget: unknown;
    existingBudgets?: unknown[];
  }) {
    // Access each collection first so MockDb lazily creates the full default
    // mock (spreading a not-yet-created entry would lose bulkWrite etc.).
    for (const name of ["states", "statePolicies", "federalBudget", "regionalBudgets"]) {
      db.collection(name);
    }
    db.collectionMocks.states.find = vi
      .fn()
      .mockImplementation(() => ({ toArray: vi.fn().mockResolvedValue(regions) }));
    db.collectionMocks.statePolicies.find = vi
      .fn()
      .mockImplementation(() => ({ toArray: vi.fn().mockResolvedValue(policies) }));
    db.collectionMocks.federalBudget.findOne = vi.fn().mockResolvedValue(budget);
    db.collectionMocks.regionalBudgets.find = vi
      .fn()
      .mockImplementation(() => ({ toArray: vi.fn().mockResolvedValue(existingBudgets) }));
  }

  const REGIONS = [
    { _id: "CEN", countryId: "RU", population: 20_000_000, gdp: 100_000 },
    { _id: "URA", countryId: "RU", population: 10_000_000, gdp: 50_000 },
  ];
  const BUDGET = { _id: "RU", spending: { stateGrants: 60_000_000_000 } };

  it("splits the pool 2:1 by population and books enacted regional law costs", async () => {
    wire({
      regions: REGIONS,
      policies: [
        {
          stateId: "CEN",
          scope: "state",
          legislationTypeId: regionLaw.id,
          policyOptionId: "l2",
          policyOptionIndex: 2,
        },
      ],
      budget: BUDGET,
    });
    const result = await processRURegionalBudgets(db as unknown as Db, 10);
    expect(result.regionsProcessed).toBe(2);
    const ops = (db.collectionMocks.regionalBudgets.bulkWrite as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Array<{ updateOne: { update: { $set: Record<string, number> } } }>;
    const cen = ops.find((o) => (o.updateOne.update.$set as { _id?: string })._id === "CEN")!
      .updateOne.update.$set;
    const ura = ops.find((o) => (o.updateOne.update.$set as { _id?: string })._id === "URA")!
      .updateOne.update.$set;
    expect(cen.unionGrant / ura.unionGrant).toBeCloseTo(2, 5);
    // CEN's enacted L2 transit law: gdp fraction × regional gdp (100,000M → 1e11)
    const expectedCost = regionLaw.levels![2].gdpCostFraction! * 100_000 * 1_000_000;
    expect(cen.enactedBillCosts).toBeCloseTo(expectedCost, 0);
    expect(ura.enactedBillCosts).toBe(0);
    expect(cen.surplus).toBeCloseTo(cen.unionGrant - expectedCost, 0);
  });

  it("counts consecutive deficit turns and downgrades the most expensive programme", async () => {
    const bigLaw = RU_LAWS.find((l) => l.id === "ru.infrastructure.publicHousing.primary")!;
    wire({
      regions: [REGIONS[0]],
      policies: [
        {
          stateId: "CEN",
          scope: "state",
          legislationTypeId: bigLaw.id,
          policyOptionId: "l4",
          policyOptionIndex: 4,
        },
      ],
      // Tiny pool → certain deficit.
      budget: { _id: "RU", spending: { stateGrants: 1_000 } },
      existingBudgets: [{ _id: "CEN", turnsOverBudget: 1 }],
    });
    await processRURegionalBudgets(db as unknown as Db, 11);
    const policyWrites = (db.collectionMocks.statePolicies.bulkWrite as ReturnType<typeof vi.fn>)
      .mock.calls;
    expect(policyWrites.length).toBe(1);
    const op = policyWrites[0][0][0].updateOne;
    expect(op.filter).toMatchObject({ stateId: "CEN", legislationTypeId: bigLaw.id });
    expect(op.update.$set.policyOptionIndex).toBe(3);
    expect(op.update.$set.policyOptionId).toBe("l3");
  });

  it("uses the baseline grants pool when the live spending pool is negative", async () => {
    const bigLaw = RU_LAWS.find((l) => l.id === "ru.infrastructure.publicHousing.primary")!;
    wire({
      regions: [REGIONS[0]],
      policies: [
        {
          stateId: "CEN",
          scope: "state",
          legislationTypeId: bigLaw.id,
          policyOptionId: "l4",
          policyOptionIndex: 4,
        },
      ],
      budget: {
        _id: "RU",
        spending: { stateGrants: -360_343_252 },
        baselineStateGrants: 60_000_000_000,
      },
      existingBudgets: [{ _id: "CEN", turnsOverBudget: 1 }],
    });

    await processRURegionalBudgets(db as unknown as Db, 11);

    const budgetWrites = (db.collectionMocks.regionalBudgets.bulkWrite as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Array<{ updateOne: { update: { $set: Record<string, number> } } }>;
    const budget = budgetWrites[0].updateOne.update.$set;
    expect(budget.unionGrant).toBe(60_000_000_000);
    expect(budget.isOverBudget).toBe(false);
    expect(db.collectionMocks.statePolicies.bulkWrite).not.toHaveBeenCalled();
  });

  it("no-ops without RU regions or a budget", async () => {
    wire({ regions: [], policies: [], budget: null });
    expect((await processRURegionalBudgets(db as unknown as Db, 1)).regionsProcessed).toBe(0);
  });
});
