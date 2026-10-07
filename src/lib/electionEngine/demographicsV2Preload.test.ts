import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import type { GameState } from "@/lib/db/types/gameState";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import type { State } from "@/lib/db/types/state";
import { createMockDb } from "@/lib/test-utils/mockDb";
import {
  loadDemographicsV2Preload,
  loadElectionRegionDemographicsV2,
} from "./demographicsV2Preload";

const vector = (value: number) => Array<number>(101).fill(value);

describe("loadDemographicsV2Preload", () => {
  it("does not read population rows for a v1 world", async () => {
    const db = createMockDb();
    const result = await loadDemographicsV2Preload({
      db: db as unknown as Db,
      countries: ["US"],
      regionFilter: { _id: { $in: ["CA"] } },
      states: [{ _id: "CA", countryId: "US" }] as State[],
      nationwideCountries: [],
      gameState: { _id: "current", demographicsSystemVersion: "v1" } as GameState,
    });

    expect(result.demographicsV2Countries.size).toBe(0);
    expect(result.regionDemographicsByState.size).toBe(0);
    expect(db.collection).not.toHaveBeenCalledWith("regionDemographics");
  });

  it("loads one projected batch and builds the nationwide live vector", async () => {
    const db = createMockDb();
    const rows: RegionDemographics[] = [
      {
        _id: "CA",
        countryId: "US",
        ages: { male: vector(1), female: vector(2) },
        lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        _id: "TX",
        countryId: "US",
        ages: { male: vector(3), female: vector(4) },
        lastUpdated: new Date("2026-02-01T00:00:00.000Z"),
      },
    ];
    const cursor = { toArray: vi.fn().mockResolvedValue(rows) };
    db.collection("regionDemographics").find.mockReturnValue(cursor);
    const gameState = {
      _id: "current",
      currentYear: 1991,
      demographicsSystemVersion: "v2",
      resetWorldId: "world-a",
      resetVersionSeeds: {
        demographics: {
          worldId: "world-a",
          revision: 1,
          sourceTurn: 1,
          completedAt: "2026-01-01T00:00:00.000Z",
          verificationHash: "verified",
          countries: ["US"],
        },
      },
    } as GameState;

    const result = await loadDemographicsV2Preload({
      db: db as unknown as Db,
      countries: ["US"],
      regionFilter: { countryId: "US" },
      states: [
        { _id: "CA", countryId: "US" },
        { _id: "TX", countryId: "US" },
      ] as State[],
      nationwideCountries: ["US"],
      gameState,
    });

    expect(db.collectionMocks.regionDemographics!.find).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.regionDemographics!.find.mock.calls[0]![1]).toEqual({
      projection: { _id: 1, countryId: 1, ages: 1, lastUpdated: 1 },
    });
    expect(result.demographicsV2Countries).toEqual(new Set(["US"]));
    expect(result.regionDemographicsByState.get("US")?.ages.male[0]).toBe(4);
    expect(result.regionDemographicsByState.get("US")?.ages.female[100]).toBe(6);
  });
});

describe("loadElectionRegionDemographicsV2", () => {
  it("does not read population rows for a standalone v1 tally", async () => {
    const db = createMockDb();

    const result = await loadElectionRegionDemographicsV2({
      db: db as unknown as Db,
      countryId: "US",
      stateId: "CA",
      gameState: { _id: "current", demographicsSystemVersion: "v1" } as GameState,
    });

    expect(result).toBeNull();
    expect(db.collection).not.toHaveBeenCalledWith("regionDemographics");
  });

  it("loads one projected regional row for a standalone v2 tally", async () => {
    const db = createMockDb();
    const row = {
      _id: "CA",
      countryId: "US",
      ages: { male: vector(1), female: vector(2) },
      lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
    } as RegionDemographics;
    db.collection("regionDemographics").findOne.mockResolvedValue(row);

    const result = await loadElectionRegionDemographicsV2({
      db: db as unknown as Db,
      countryId: "US",
      stateId: "CA",
      gameState: {
        _id: "current",
        demographicsSystemVersion: "v2",
        resetWorldId: "world-a",
        resetVersionSeeds: {
          demographics: {
            worldId: "world-a",
            revision: 1,
            sourceTurn: 1,
            completedAt: "2026-01-01T00:00:00.000Z",
            verificationHash: "verified",
            countries: ["US"],
          },
        },
      } as GameState,
    });

    expect(result).toBe(row);
    expect(db.collectionMocks.regionDemographics!.findOne).toHaveBeenCalledWith(
      { _id: "CA", countryId: "US" },
      { projection: { _id: 1, countryId: 1, ages: 1, lastUpdated: 1 } }
    );
  });

  it("aggregates every regional row for a standalone nationwide v2 tally", async () => {
    const db = createMockDb();
    const rows = [
      {
        _id: "CA",
        countryId: "US",
        ages: { male: vector(1), female: vector(2) },
        lastUpdated: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        _id: "TX",
        countryId: "US",
        ages: { male: vector(3), female: vector(4) },
        lastUpdated: new Date("2026-02-01T00:00:00.000Z"),
      },
    ] as RegionDemographics[];
    db.collection("regionDemographics").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(rows),
    });

    const result = await loadElectionRegionDemographicsV2({
      db: db as unknown as Db,
      countryId: "US",
      stateId: "US",
      gameState: {
        _id: "current",
        demographicsSystemVersion: "v2",
        resetWorldId: "world-a",
        resetVersionSeeds: {
          demographics: {
            worldId: "world-a",
            revision: 1,
            sourceTurn: 1,
            completedAt: "2026-01-01T00:00:00.000Z",
            verificationHash: "verified",
            countries: ["US"],
          },
        },
      } as GameState,
    });

    expect(result?.ages.male[0]).toBe(4);
    expect(result?.ages.female[100]).toBe(6);
    expect(result?.lastUpdated).toEqual(new Date("2026-02-01T00:00:00.000Z"));
  });
});
