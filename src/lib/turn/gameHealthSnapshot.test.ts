import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { TurnPhaseTelemetryMap } from "@/lib/db/types";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

// Collections used by the implementation — pre-create so mocks are available before execution
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
  "bonds",
  "corporations",
  "federalBudget",
];

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  // Pre-populate collection mocks so they exist before test setup
  for (const name of COLLECTIONS) {
    db.collection(name);
  }
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  db.collectionMocks.seats.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
  db.collectionMocks.electedOfficials.find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue([]),
  });
});

describe("processGameHealthSnapshot", () => {
  it("writes a snapshot with population and economy stats", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    // systemSettings cadence = 1 → integrity check runs every turn
    db.collectionMocks.systemSettings.findOne.mockResolvedValue({
      _id: "healthConfig",
      integrityCheckCadenceTurns: 1,
      updatedBy: null,
      updatedAt: new Date(),
    });

    // Population counts
    db.collectionMocks.users.countDocuments.mockResolvedValue(10);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(8);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(100);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(500);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(12);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(3);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(400);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    // Aggregation mocks — return empty arrays by default
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.electedOfficials.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.corporations.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.characters.aggregate.mockReturnValue(emptyAgg);

    // Central banks
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    // National stateMetrics
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const result = await processGameHealthSnapshot(db as unknown as Db, 42, 2026, 1500, true, []);

    expect(result).toEqual({ snapshotWritten: true, integrityCheckRan: true });
    expect(db.collectionMocks.gameHealthSnapshots.insertOne).toHaveBeenCalledTimes(1);

    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.turn).toBe(42);
    expect(doc.year).toBe(2026);
    expect(doc.turnProcessing.durationMs).toBe(1500);
    expect(doc.turnProcessing.success).toBe(true);
    expect(doc.turnProcessing.phaseStatuses).toEqual({});
    expect(doc.dataIntegrity).not.toBeNull();
    expect(doc.population).toBeDefined();
    expect(doc.population.activePlayers).toBe(10);
    expect(doc.economy).toBeDefined();
  });

  it("skips integrity check when turn does not match cadence", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue({
      _id: "healthConfig",
      integrityCheckCadenceTurns: 12,
      updatedBy: null,
      updatedAt: new Date(),
    });

    // Minimal mocks for population/economy
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(0);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(0);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.corporations.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    const result = await processGameHealthSnapshot(
      db as unknown as Db,
      5, // not divisible by 12
      2026,
      800,
      true,
      []
    );

    expect(result).toEqual({ snapshotWritten: true, integrityCheckRan: false });
    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.dataIntegrity).toBeNull();
  });

  it("parses failed phases into structured TurnError objects", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue(null); // default cadence 1

    // Mocks for population/economy
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(0);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(0);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.corporations.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });

    // Integrity check mocks
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.electedOfficials.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    const now = new Date("2026-04-29T09:00:00.000Z");

    const result = await processGameHealthSnapshot(
      db as unknown as Db,
      1, // divisible by default cadence 1
      2026,
      500,
      false,
      ["nppBehavior: 3 NPPs skipped entry", "billLifecycle: timeout on bill #42"],
      {
        nppBehavior: {
          status: "failed",
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          reason: "other",
          message: null,
        },
        billLifecycle: {
          status: "failed",
          startedAt: now,
          completedAt: now,
          updatedAt: now,
          reason: "other",
          message: null,
        },
      } satisfies TurnPhaseTelemetryMap
    );

    expect(result.snapshotWritten).toBe(true);
    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.turnProcessing.warningCount).toBe(0);
    expect(doc.turnProcessing.errorCount).toBe(2);
    expect(doc.turnProcessing.errors[0].phase).toBe("nppBehavior");
    expect(doc.turnProcessing.errors[0].message).toBe("3 NPPs skipped entry");
    expect(doc.turnProcessing.errors[1].phase).toBe("billLifecycle");
  });

  it("reads inflation from federalBudget and computes phaseCount from phase telemetry", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue({
      _id: "healthConfig",
      integrityCheckCadenceTurns: 99, // skip integrity checks
      updatedBy: null,
      updatedAt: new Date(),
    });

    // Population mocks
    db.collectionMocks.users.countDocuments.mockResolvedValue(5);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(3);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(50);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(100);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(4);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(1);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(80);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);

    // Central banks
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "US", countryId: "US", primeRate: 0.05 }]),
    });

    // National stateMetrics
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "federal", economic: { gdpGrowth: { value: 0.023 } } }]),
    });

    // Federal budget with inflation
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "federal", economicFactors: { inflationRate: 0.035 } }]),
    });

    // Bonds + corp + fund aggregations
    db.collectionMocks.bonds.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "US", total: 0, defaulted: 0 }]),
    });
    db.collectionMocks.corporations.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "US", totalRevenue: 500000 }]),
    });
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "US", avgFunds: 1200, totalFunds: 36000 }]),
    });

    const now = new Date("2026-04-29T10:00:00.000Z");
    const fakePhaseStatuses: TurnPhaseTelemetryMap = {
      actionRefresh: {
        status: "completed",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        reason: null,
        message: null,
      },
      fundGeneration: {
        status: "completed",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        reason: null,
        message: null,
      },
      nppBehavior: {
        status: "failed",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        reason: "other",
        message: "Phase crashed",
      },
      fiscalYear: {
        status: "skipped",
        startedAt: null,
        completedAt: now,
        updatedAt: now,
        reason: "conditional",
        message: "Skipped because this turn is not a fiscal year boundary.",
      },
      billLifecycle: {
        status: "completed",
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        reason: null,
        message: null,
      },
      gameHealthSnapshot: {
        status: "running",
        startedAt: now,
        completedAt: null,
        updatedAt: now,
        reason: null,
        message: null,
      },
    };

    const result = await processGameHealthSnapshot(
      db as unknown as Db,
      10,
      2026,
      2000,
      false,
      ["nppBehavior: Phase crashed"],
      fakePhaseStatuses
    );

    expect(result).toEqual({ snapshotWritten: true, integrityCheckRan: false });
    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];

    // phaseCount should be 5 (excludes gameHealthSnapshot)
    expect(doc.turnProcessing.phaseCount).toBe(5);
    // phasesSkipped should be 1 (fiscalYear is skipped)
    expect(doc.turnProcessing.phasesSkipped).toBe(1);
    expect(doc.turnProcessing.errorCount).toBe(1);
    expect(doc.turnProcessing.phaseStatuses.gameHealthSnapshot.status).toBe("completed");
    expect(doc.turnProcessing.phaseStatuses.fiscalYear.message).toContain("not a fiscal year");

    // Verify inflation was read from federalBudget
    expect(db.collectionMocks.federalBudget.find).toHaveBeenCalled();
    // Economy should have US data with correct inflation
    const usEcon = doc.economy.byCountry.US;
    expect(usEcon).toBeDefined();
    expect(usEcon.inflation).toBe(0.035);
    // `gdp` and `gdpGrowth` are now distinct: the field named `gdp` used to hold
    // the growth RATE, which made a healthy economy look like it was collapsing
    // whenever growth decelerated toward potential. `gdpGrowth` carries the rate;
    // `gdp` carries the level summed from states.gdp (0 here — this mock seeds no
    // states).
    expect(usEcon.gdpGrowth).toBe(0.023);
    expect(usEcon.gdp).toBe(0);
    expect(usEcon.interestRate).toBe(0.05);
  });

  it("does not false-flag modern officials that derive to a known seat", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(1);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(1);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.corporations.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.seats.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "US-senate-AL-2", countryId: "US", electionType: "senate" }]),
    });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { countryId: "US", officeType: "senate", state: "AL", senateClass: 2 },
        ]),
    });

    await processGameHealthSnapshot(db as unknown as Db, 12, 2026, 750, true, []);

    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.dataIntegrity.orphanedOfficials).toBe(0);
    expect(doc.dataIntegrity.seatBackedSeatsWithoutOfficials).toBe(0);
    expect(
      doc.dataIntegrity.issues.some(
        (issue: { category: string }) => issue.category === "orphanedOfficial"
      )
    ).toBe(false);
  });

  it("does not treat another country's seat-backed office type as local", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(1);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(1);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.corporations.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.seats.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: "US-governor-AL", countryId: "US", electionType: "governor" }]),
    });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ countryId: "RU", officeType: "governor", state: "CEN" }]),
    });

    await processGameHealthSnapshot(db as unknown as Db, 12, 2026, 750, true, []);

    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.dataIntegrity.orphanedOfficials).toBe(0);
    expect(
      doc.dataIntegrity.issues.some(
        (issue: { category: string }) => issue.category === "orphanedOfficial"
      )
    ).toBe(false);
  });

  it("flags officials with no matching office configuration", async () => {
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(0);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(1);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.corporations.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.seats.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.electedOfficials.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ countryId: "US", officeType: "madeUpOffice" }]),
    });

    await processGameHealthSnapshot(db as unknown as Db, 12, 2026, 750, true, []);

    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.dataIntegrity.orphanedOfficials).toBe(1);
    expect(doc.dataIntegrity.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "orphanedOfficial",
          message: "1 officials could not be matched to a known seat or office configuration",
        }),
      ])
    );
  });

  it("flags a country whose centralBanks doc has no matching federalBudget", async () => {
    // Regression test for sandbox-seed-audit-t101: a country bootstrapped via
    // a partial seed path can end up with a live central bank and zero budget
    // documents, silently skipped by every consumer. This must now surface as
    // a data-integrity error instead of going unnoticed.
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(0);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(0);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ countryId: "US" }]),
    });
    db.collectionMocks.federalBudget.countDocuments.mockResolvedValue(0);
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.corporations.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.characters.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.electedOfficials.aggregate.mockReturnValue(emptyAgg);

    await processGameHealthSnapshot(db as unknown as Db, 101, 1955, 750, true, []);

    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.dataIntegrity.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "missingFederalBudget",
          severity: "error",
          message: expect.stringContaining("US"),
        }),
      ])
    );
  });

  it("flags a federalBudget doc whose countryId doesn't match its _id convention", async () => {
    // Regression test for sandbox-seed-audit-t101: the sandbox's `_id: "federal"`
    // budget (US's, by convention) was actively updated every turn while
    // carrying `countryId: "BAL"`.
    const { processGameHealthSnapshot } = await import("./gameHealthSnapshot");

    db.collectionMocks.systemSettings.findOne.mockResolvedValue(null);
    db.collectionMocks.users.countDocuments.mockResolvedValue(0);
    db.collectionMocks.characters.countDocuments.mockResolvedValue(0);
    db.collectionMocks.npps.countDocuments.mockResolvedValue(0);
    db.collectionMocks.seats.countDocuments.mockResolvedValue(0);
    db.collectionMocks.politicalParties.countDocuments.mockResolvedValue(0);
    db.collectionMocks.elections.countDocuments.mockResolvedValue(0);
    db.collectionMocks.electedOfficials.countDocuments.mockResolvedValue(0);
    db.collectionMocks.bonds.countDocuments.mockResolvedValue(0);
    db.collectionMocks.centralBanks.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.macroMetrics.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collectionMocks.federalBudget.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "federal", countryId: "BAL" }]),
    });
    const emptyAgg = { toArray: vi.fn().mockResolvedValue([]) };
    db.collectionMocks.electionCandidates.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.partyMembers.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.elections.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.corporations.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.characters.aggregate.mockReturnValue(emptyAgg);
    db.collectionMocks.electedOfficials.aggregate.mockReturnValue(emptyAgg);

    await processGameHealthSnapshot(db as unknown as Db, 101, 1955, 750, true, []);

    const doc = db.collectionMocks.gameHealthSnapshots.insertOne.mock.calls[0][0];
    expect(doc.dataIntegrity.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "federalBudgetCountryMismatch",
          severity: "error",
          message: expect.stringContaining('countryId "BAL", expected "US"'),
        }),
      ])
    );
  });
});
