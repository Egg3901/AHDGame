import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { getEraContext, resolveWorldSeedYear } from "./context";

describe("getEraContext", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  function stubGameState(doc: Record<string, unknown>) {
    db.collection("gameState").findOne.mockResolvedValue(doc);
  }

  it("returns null year while the flag is off, even with a live year", async () => {
    stubGameState({ _id: "current", currentYear: 2008, preset: "1991-default" });
    expect(await getEraContext(db as unknown as Db)).toEqual({
      year: null,
      preset: "1991-default",
      startingYear: null,
      incomeBandIndexByCountry: null,
    });
  });

  it("returns the live year when the flag is on", async () => {
    stubGameState({
      _id: "current",
      currentYear: 2008,
      preset: "1991-default",
      eraSystemEnabled: true,
    });
    expect((await getEraContext(db as unknown as Db)).year).toBe(2008);
  });

  it("derives from turn + startingYear when currentYear is absent", async () => {
    stubGameState({
      _id: "current",
      currentTurn: 822,
      startingYear: 1991,
      eraSystemEnabled: true,
    });
    expect((await getEraContext(db as unknown as Db)).year).toBe(2008);
  });

  it("returns nulls when no gameState row exists", async () => {
    expect(await getEraContext(db as unknown as Db)).toEqual({
      year: null,
      preset: null,
      startingYear: null,
      incomeBandIndexByCountry: null,
    });
  });

  it("exposes startingYear + income index map when the flag is on", async () => {
    stubGameState({
      _id: "current",
      currentYear: 2008,
      startingYear: 1991,
      eraSystemEnabled: true,
      incomeBandIndexByCountry: { UK: 1.2 },
    });
    const ctx = await getEraContext(db as unknown as Db);
    expect(ctx.startingYear).toBe(1991);
    expect(ctx.incomeBandIndexByCountry).toEqual({ UK: 1.2 });
  });
});

describe("resolveWorldSeedYear", () => {
  let db: MockDb;
  beforeEach(() => {
    db = createMockDb();
  });

  it("falls back to the PRESET's starting year when no gameState exists", async () => {
    // Load-bearing: during a fresh bootstrap both runSeed and
    // seedPoliticalMetrics run before initializeGameState, so this fallback is
    // the normal path, not an edge case. A hardcoded default here would seed
    // 1953 political baselines into a 2019 world.
    db.collection("gameState").findOne.mockResolvedValue(null);
    expect(await resolveWorldSeedYear(db as unknown as Db, "2019-default")).toBe(2019);
    expect(await resolveWorldSeedYear(db as unknown as Db, "1979-default")).toBe(1979);
    expect(await resolveWorldSeedYear(db as unknown as Db, "1953-default")).toBe(1953);
  });

  it("prefers the world's live year over the preset when a gameState exists", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current", currentYear: 1966 });
    expect(await resolveWorldSeedYear(db as unknown as Db, "1953-default")).toBe(1966);
  });

  it("derives the year from turn + startingYear on legacy rows", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 1,
      startingYear: 1979,
    });
    expect(await resolveWorldSeedYear(db as unknown as Db, "2019-default")).toBe(1979);
  });
});
