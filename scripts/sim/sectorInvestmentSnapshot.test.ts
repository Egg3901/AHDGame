import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { assertInvestmentTurnComplete, snapshotSectorInvestment } from "./sectorInvestmentSnapshot";

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("balance replay validity", () => {
  it("accepts completed phases and intentionally skipped features", () => {
    expect(() =>
      assertInvestmentTurnComplete(705, 705, {
        turn: 705,
        phaseStatuses: {
          corporationTurn: { status: "completed" },
          disabledFeature: { status: "skipped" },
        },
      })
    ).not.toThrow();
  });
  it("rejects a phase failure even when the engine advanced its clock and cleared live telemetry", () => {
    expect(() =>
      assertInvestmentTurnComplete(705, 705, {
        turn: 705,
        phaseStatuses: {
          corporationTurn: { status: "failed" },
          laterPhase: { status: "completed" },
        },
      })
    ).toThrow(/corporationTurn/);
  });
  it("rejects a crashed, incomplete or unrecorded turn", () => {
    for (const status of ["pending", "running", "notReached"]) {
      expect(() =>
        assertInvestmentTurnComplete(705, 705, {
          turn: 705,
          phaseStatuses: {
            corporationTurn: { status },
          },
        })
      ).toThrow();
    }
    expect(() => assertInvestmentTurnComplete(705, 704, null)).toThrow();
    expect(() => assertInvestmentTurnComplete(705, 705, { turn: 705 })).toThrow();
  });

  it("captures a bounded strategy observation in a fixed query budget and writes private artifacts", async () => {
    const db = Object.assign(createMockDb(), {
      databaseName: "ahd_sim_issue2335",
    });
    const nppIds = Array.from({ length: 20 }, (_, index) => `npp-${index + 1}`);
    const nppSectors = nppIds.map((corporationId, index) => ({
      _id: `sector-${index + 1}`,
      corporationId,
      ...(index === 0 ? {} : { countryId: "country-a" }),
      stateId: "state-a",
      sectorType: "extraction",
      strategyId: "standard",
      transitionFromStrategyId: null,
      soldFraction: 0.4,
      capitalStock: 10,
      clearingStartTurn: 700,
      throughputStartTurn: 701,
      soldByCommodity: { iron: 12 },
    }));
    const playerSector = {
      ...nppSectors[0],
      _id: "sector-player",
      corporationId: "player",
      stateId: "state-b",
    };
    const caretakerSectors = ["caretaker-false", "caretaker-null"].map((corporationId) => ({
      ...nppSectors[0],
      _id: `sector-${corporationId}`,
      corporationId,
    }));
    const docs: Record<string, Record<string, unknown>[]> = {
      corporateSectors: [...nppSectors, playerSector, ...caretakerSectors],
      corporations: [
        ...nppIds.map((_id) => ({
          _id,
          countryId: "country-a",
          type: "extraction",
          ceoType: "npp",
          userId: "000000000000000000000000",
        })),
        {
          _id: "caretaker",
          countryId: "country-a",
          ceoType: "npp",
          userId: "000000000000000000000000",
          caretakerCeo: true,
        },
        {
          _id: "caretaker-false",
          countryId: "country-a",
          ceoType: "npp",
          userId: "000000000000000000000000",
          caretakerCeo: false,
        },
        {
          _id: "caretaker-null",
          countryId: "country-a",
          ceoType: "npp",
          userId: "000000000000000000000000",
          caretakerCeo: null,
        },
        {
          _id: "suspended",
          countryId: "country-a",
          ceoType: "npp",
          userId: "000000000000000000000000",
          suspended: true,
        },
        {
          _id: "player",
          countryId: "country-a",
          ceoType: "human",
          userId: "private-user",
        },
      ],
      corporationHistory: [],
      exchangeRates: [],
      macroMetrics: [],
      federalBudget: [],
      bonds: [],
      commodityPrices: [
        {
          commodity: "iron",
          globalSupply: 10,
          globalDemand: 20,
          stateSupply: { "state-a": 2 },
          globalPrice: 120,
          basePrice: 100,
          reachablePrices: { "country-a": 110 },
          stateInputAvailability: { "state-a": 0.8 },
        },
      ],
      economicVitalSigns: [],
    };
    for (const name of Object.keys(docs)) db.collection(name);
    for (const [name, collection] of Object.entries(db.collectionMocks)) {
      collection.find.mockImplementation(() => ({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue(docs[name] ?? []),
      }));
    }
    const capacities = db.collection("stateResourceCapacity");
    capacities.find.mockImplementation(() => ({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          stateId: "state-a",
          countryId: "country-a",
          resources: { iron: 500 },
        },
        {
          stateId: "state-b",
          countryId: "country-a",
          resources: { iron: 900 },
        },
      ]),
    }));
    db.collection("gameConfig").findOne.mockResolvedValue({
      marketSystemMode: "clearing",
      freightSettlementMode: "active",
      marketGovernorCap: 0.2,
    });
    db.collection("gameState").findOne.mockResolvedValue({
      currentTurn: 705,
      extractionAutoStrategyEnabled: true,
      lastExtractionAutoStrategyTurn: 705,
      nppEntryViabilityMode: "observe",
    });
    db.collection("tradeFlowSnapshots").findOne.mockResolvedValue({
      turn: 704,
      books: {
        "country-a": { iron: { supply: 10, demand: 8 } },
        "country-b": { gold: { supply: 2, demand: 1 } },
      },
    });

    const directory = await mkdtemp(join(tmpdir(), "ahd-investment-"));
    tempDirs.push(directory);
    const result = await snapshotSectorInvestment(
      db as unknown as Db,
      directory,
      705,
      { runId: "run-2335", seed: "seed-12", codeVersion: "a".repeat(40) },
      "opening-state"
    );
    const saved = JSON.parse(await readFile(join(directory, "705.json"), "utf8"));
    const scorer = saved.extractionStrategyObservation;
    expect(saved.sourceMetadata).toEqual({
      runId: "run-2335",
      seed: "seed-12",
      codeVersion: "a".repeat(40),
    });
    expect(saved.captureQualificationEligible).toBe(true);
    expect(result.strategyInputCount).toBe(20);
    const queryCount = Object.values(db.collectionMocks).reduce(
      (total, collection) =>
        total + collection.find.mock.calls.length + collection.findOne.mock.calls.length,
      0
    );
    expect(queryCount).toBe(13);
    expect(scorer.observationClass).toBe("opening-state");
    expect(scorer.observationTurn).toBe(705);
    expect(scorer.prospectiveEvaluationTurn).toBe(706);
    expect(scorer.observationLimits).toHaveLength(3);
    expect(scorer.nppSectors).toHaveLength(20);
    expect(scorer.nppSectors[0].resolvedCountryId).toBe("country-a");
    expect(scorer.eligibleNppCorporations.map((corp: { _id: string }) => corp._id)).toEqual(nppIds);
    expect(
      scorer.extractionCompetition.map((sector: { ownerKind: string }) => sector.ownerKind)
    ).toEqual([...Array.from({ length: 20 }, () => "npp"), "other", "other", "other"]);
    expect(scorer.stateResourceCapacity).toEqual([
      { stateId: "state-a", countryId: "country-a", resources: { iron: 500 } },
    ]);
    expect(scorer.tradeFlowSnapshot).toEqual({
      turn: 704,
      books: { "country-a": { iron: { supply: 10, demand: 8 } } },
    });
    expect(scorer.tradeFlowSnapshot.books["country-b"]).toBeUndefined();
    expect(scorer.config).toEqual({
      marketSystemMode: "clearing",
      freightSettlementMode: "active",
      marketGovernorCap: 0.2,
    });
    expect(saved.corporateSectors[0].soldByCommodity).toEqual({ iron: 12 });
    expect(db.collectionMocks.tradeFlowSnapshots.findOne).toHaveBeenCalledWith(
      { books: { $exists: true }, turn: { $lte: 705 } },
      { sort: { turn: -1 }, projection: { turn: 1, books: 1 } }
    );
    // Windows does not expose POSIX mode bits through stat, even after chmod.
    if (process.platform !== "win32") {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, "705.json"))).mode & 0o777).toBe(0o600);
    }
    expect(JSON.stringify(scorer)).not.toContain("private-user");
    expect(() => JSON.stringify(scorer)).not.toThrow();

    db.collectionMocks.tradeFlowSnapshots.findOne.mockClear();
    db.collectionMocks.gameConfig.findOne.mockResolvedValue({
      marketSystemMode: "off",
    });
    await snapshotSectorInvestment(db as unknown as Db, directory, 705);
    const unpinned = JSON.parse(await readFile(join(directory, "705.json"), "utf8"));
    expect(unpinned.sourceMetadata).toBeNull();
    expect(unpinned.captureQualificationEligible).toBe(false);
    expect(unpinned.extractionStrategyObservation.observationClass).toBe("post-turn-state");
    expect(db.collectionMocks.stateResourceCapacity.find).toHaveBeenCalledTimes(2);
    expect(db.collectionMocks.tradeFlowSnapshots.findOne).not.toHaveBeenCalled();
  });

  it("rejects non-finite ranking inputs instead of emitting invalid JSON", async () => {
    const db = createMockDb();
    for (const name of [
      "corporateSectors",
      "corporations",
      "corporationHistory",
      "exchangeRates",
      "macroMetrics",
      "federalBudget",
      "bonds",
      "commodityPrices",
      "economicVitalSigns",
      "stateResourceCapacity",
      "gameConfig",
      "gameState",
      "tradeFlowSnapshots",
    ]) {
      db.collection(name);
    }
    for (const collection of Object.values(db.collectionMocks)) {
      collection.find.mockReturnValue({
        project: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });
    }
    db.collection("stateResourceCapacity").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    db.collection("gameConfig").findOne.mockResolvedValue({
      marketSystemMode: "off",
    });
    db.collection("gameState").findOne.mockResolvedValue({ currentTurn: 705 });
    db.collection("tradeFlowSnapshots").findOne.mockResolvedValue(null);
    db.collection("commodityPrices").find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([{ commodity: "iron", globalPrice: Number.NaN }]),
    });
    const directory = await mkdtemp(join(tmpdir(), "ahd-investment-invalid-"));
    tempDirs.push(directory);
    await expect(snapshotSectorInvestment(db as unknown as Db, directory, 705)).rejects.toThrow(
      /Non-finite simulation input/
    );
    expect(db.collectionMocks.stateResourceCapacity.find).not.toHaveBeenCalled();
    expect(db.collectionMocks.tradeFlowSnapshots.findOne).not.toHaveBeenCalled();
  });

  it("rejects invalid provenance and qualified captures outside an ahd_sim database before reads", async () => {
    const sandboxDb = Object.assign(createMockDb(), {
      databaseName: "ahd_sim_provenance",
    });
    await expect(
      snapshotSectorInvestment(sandboxDb as unknown as Db, "/unused", 705, {
        runId: "run",
        seed: "seed",
        codeVersion: "bad-sha",
      })
    ).rejects.toThrow(/40-character code version/);
    expect(sandboxDb.collection).not.toHaveBeenCalled();
    await expect(
      snapshotSectorInvestment(sandboxDb as unknown as Db, "/unused", 705, {
        runId: " ",
        seed: "",
        codeVersion: "a".repeat(40),
      })
    ).rejects.toThrow(/nonempty run and seed/);
    expect(sandboxDb.collection).not.toHaveBeenCalled();

    const nonSandboxDb = Object.assign(createMockDb(), {
      databaseName: "ahd_main",
    });
    await expect(
      snapshotSectorInvestment(nonSandboxDb as unknown as Db, "/unused", 705, {
        runId: "run",
        seed: "seed",
        codeVersion: "b".repeat(40),
      })
    ).rejects.toThrow(/restricted to an ahd_sim_ sandbox/);
    expect(nonSandboxDb.collection).not.toHaveBeenCalled();
  });

  it("rejects invalid observation clocks before reading or writing artifacts", async () => {
    const db = createMockDb();
    for (const turn of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(snapshotSectorInvestment(db as unknown as Db, "/unused", turn)).rejects.toThrow(
        /safe-integer turn/
      );
    }
    expect(db.collection).not.toHaveBeenCalled();
  });
});
