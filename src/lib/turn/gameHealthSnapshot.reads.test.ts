import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

// Collections touched by the health snapshot path under test.
const COLLECTIONS = [
  "systemSettings",
  "gameHealthSnapshots",
  "users",
  "characters",
  "npps",
  "seats",
  "politicalParties",
  "elections",
  "electedOfficials",
  "electionCandidates",
  "partyMembers",
  "centralBanks",
  "macroMetrics",
  "corporations",
  "corporateSectors",
  "states",
  "bonds",
  "federalBudget",
  "exchangeRates",
  "countryGameStates",
];

function mockCount(name: string, value: number) {
  db.collectionMocks[name].countDocuments.mockResolvedValue(value);
}

function mockFind(name: string, docs: unknown[]) {
  db.collectionMocks[name].find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
  });
}

function mockAggregate(name: string, docs: unknown[]) {
  db.collectionMocks[name].aggregate.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(docs),
  });
}

async function setupQuietWorld() {
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  db.collectionMocks.systemSettings.findOne.mockResolvedValue({
    _id: "healthConfig",
    integrityCheckCadenceTurns: 1,
    updatedBy: null,
    updatedAt: new Date(),
  });
  for (const name of [
    "users",
    "characters",
    "npps",
    "seats",
    "politicalParties",
    "elections",
    "electedOfficials",
    "bonds",
  ]) {
    mockCount(name, 0);
  }
  for (const name of ["corporations", "corporateSectors", "characters", "states", "bonds"]) {
    mockAggregate(name, []);
  }
  mockFind("centralBanks", []);
  mockFind("macroMetrics", []);
  mockFind("federalBudget", []);
  mockFind("exchangeRates", []);
  mockFind("seats", []);
  mockFind("electedOfficials", []);
}

beforeEach(() => {
  vi.resetModules();
  db = createMockDb();
  for (const name of COLLECTIONS) {
    db.collection(name);
  }
});

/**
 * Regression for #2166: the health snapshot ran unbounded multi-collection
 * $lookup aggregations and full unprojected federalBudget reads on turn
 * cadence. These assertions pin the bounded read shape:
 * - integrity $lookup pipelines project to join keys before the $lookup, so
 *   only join keys (not full documents) flow through the join;
 * - federalBudget, centralBanks, and macroMetrics reads carry projections.
 */
describe("gameHealthSnapshot bounded reads (#2166)", () => {
  it("projects join keys before integrity $lookups", { timeout: 60000 }, async () => {
    await setupQuietWorld();
    mockAggregate("electionCandidates", []);
    mockAggregate("partyMembers", []);
    mockAggregate("elections", []);
    db.collectionMocks.electedOfficials.aggregate?.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");
    const result = await processGameHealthSnapshot(db as unknown as Db, 12, 2026, 100, true, []);
    expect(result.integrityCheckRan).toBe(true);

    const pipelines: Record<string, unknown[]> = {
      electionCandidates: db.collectionMocks.electionCandidates.aggregate.mock.calls[0][0],
      partyMembers: db.collectionMocks.partyMembers.aggregate.mock.calls[0][0],
      elections: db.collectionMocks.elections.aggregate.mock.calls[0][0],
    };
    for (const [collection, pipeline] of Object.entries(pipelines)) {
      const lookupIdx = pipeline.findIndex(
        (stage) => typeof stage === "object" && stage !== null && "$lookup" in stage
      );
      expect(lookupIdx, `${collection}: pipeline must contain a $lookup`).toBeGreaterThan(-1);
      expect(pipeline[lookupIdx]).toMatchObject({
        $lookup: { pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }] },
      });
      const before = pipeline.slice(0, lookupIdx);
      expect(
        before.some((stage) => typeof stage === "object" && stage !== null && "$project" in stage),
        `${collection}: pipeline must project before the $lookup`
      ).toBe(true);
    }
  });

  it(
    "projects federalBudget, centralBanks, and macroMetrics reads",
    { timeout: 60000 },
    async () => {
      await setupQuietWorld();
      mockAggregate("electionCandidates", []);
      mockAggregate("partyMembers", []);
      mockAggregate("elections", []);

      const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");
      await processGameHealthSnapshot(db as unknown as Db, 12, 2026, 100, true, []);

      for (const name of ["federalBudget", "centralBanks", "macroMetrics"]) {
        const calls = db.collectionMocks[name].find.mock.calls;
        expect(calls.length, `${name}: expected at least one find`).toBeGreaterThan(0);
        for (const call of calls) {
          const options = call[1] as { projection?: Record<string, number> } | undefined;
          expect(options?.projection, `${name}: find must carry a projection`).toBeDefined();
        }
      }
      for (const call of db.collectionMocks.federalBudget.find.mock.calls) {
        const projection = (call[1] as { projection?: Record<string, number> }).projection!;
        expect(projection.countryId).toBe(1);
      }
      // centralBanks is read twice: the budget-integrity helper (countryId) and
      // the economy collector (rate). Every read projects; the economy read
      // carries the rate.
      const bankProjections = db.collectionMocks.centralBanks.find.mock.calls.map(
        (call) =>
          (
            call[1] as {
              projection?: Record<string, number>;
            }
          ).projection!
      );
      expect(bankProjections.some((p) => p.primeRate === 1)).toBe(true);
    }
  );

  it(
    "still detects orphaned candidates with identical counts (integrity preserved)",
    { timeout: 60000 },
    async () => {
      await setupQuietWorld();
      mockAggregate("electionCandidates", [{ count: 3 }]);
      mockAggregate("partyMembers", [{ count: 1 }]);
      mockAggregate("elections", []);

      const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");
      await processGameHealthSnapshot(db as unknown as Db, 12, 2026, 100, true, []);

      const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
      expect(doc.dataIntegrity.orphanedCandidates).toBe(3);
      expect(doc.dataIntegrity.membersInDeletedParties).toBe(1);
      expect(doc.dataIntegrity.electionsWithoutCandidates).toBe(0);
      const categories = doc.dataIntegrity.issues.map((i: { category: string }) => i.category);
      expect(categories).toContain("orphanedCandidate");
      expect(categories).toContain("orphanedMember");
    }
  );
});
