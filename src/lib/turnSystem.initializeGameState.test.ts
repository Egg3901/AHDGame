import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("initializeGameState", () => {
  let insertedDoc: Record<string, unknown> | null;
  let existingDoc: Record<string, unknown> | null;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedDoc = null;
    existingDoc = null;

    const collection = (name: string) => {
      if (name === "gameState") {
        return {
          findOne: vi.fn().mockImplementation(async () => existingDoc),
          insertOne: vi.fn().mockImplementation(async (doc: Record<string, unknown>) => {
            insertedDoc = doc;
            return { acknowledged: true, insertedId: doc._id };
          }),
        };
      }
      return {
        findOne: vi.fn().mockResolvedValue(null),
        insertOne: vi.fn(),
      };
    };

    return import("@/lib/mongodb").then(async (m) => {
      vi.mocked(m.getDb).mockResolvedValue({ collection } as never);
    });
  });

  it("bakes both startingYear and preset on the new gameState doc", async () => {
    const { initializeGameState } = await import("./turnSystem");
    await initializeGameState();

    expect(insertedDoc).not.toBeNull();
    // Both fields must be paired so `cycleAnchorContextFromGameState` never
    // falls back to 2019-default against a non-default startingYear.
    expect(insertedDoc).toMatchObject({
      startingYear: 2019,
      preset: "2019-default",
    });
  }, 30000);

  it("bakes the production-default feature flags into a fresh world", async () => {
    const { initializeGameState } = await import("./turnSystem");
    await initializeGameState();

    expect(insertedDoc).toMatchObject({
      forexEnabled: true,
      playerRandomEventsEnabled: true,
      crisisInteractionEnabled: true,
      autoDisastersEnabled: true,
      crisisAidBillsEnabled: true,
      rpgStatsEnabled: true,
      // Off by default: the 48-turn automatic sector reseed favours the state
      // corp over private/spun-out corps (#2926) and re-seeds a deliberately
      // shaped world. The one gameplay toggle held off; everything else is on.
      autoSectorSeedEnabled: false,
      sectorTechTreesEnabled: true,
      nppAutonomyLevel: "v4",
      nppAutonomyEnabled: true,
    });
    // Full feature set now defaults on for fresh worlds (2026-07-20). This
    // includes the formerly-staged systems + the granular demographics rework.
    expect(insertedDoc).toMatchObject({
      redistrictingEnabled: true,
      demographicsLayer1PositionsEnabled: true,
      conflictsEnabled: true,
      coldWarEnabled: true,
      granularPollEnabled: true,
      subsidiaryCorporationsEnabled: true,
      liveElectionResultsEnabled: true,
    });
    // Fresh worlds now boot with every rollout ladder at its top tier
    // (nppAutonomyLevel v4), and the newly-added gameplay flags on.
    expect(insertedDoc).toMatchObject({
      corpDealsEnabled: true,
      intOrgAlignmentEnabled: true,
    });
    // eurozoneEnabled is era-derived — seedForex sets it per preset, so it is
    // absent on the bare init doc.
    expect(insertedDoc).not.toHaveProperty("eurozoneEnabled");
  }, 30000);

  it("does not overwrite an existing gameState doc", async () => {
    existingDoc = {
      _id: "current",
      startingYear: 1991,
      preset: "1991-default",
      currentTurn: 100,
    };
    const { initializeGameState } = await import("./turnSystem");
    const result = await initializeGameState();

    expect(insertedDoc).toBeNull();
    expect(result.startingYear).toBe(1991);
    expect(result.preset).toBe("1991-default");
  });
});
