import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";
import { getNationalDocId } from "@/lib/constants/nationalScope";
import {
  assertCredibilityPhasesCompleted,
  captureCentralBankCredibilityTurn,
} from "./centralBankCredibilitySnapshot";

describe("sandbox central-bank credibility observations", () => {
  const input = { runId: "credibility", seed: "seed", codeVersion: "a".repeat(40), turn: 3 };
  let memory: ReturnType<typeof createInMemoryDb> & { databaseName: string };
  let db: Db;

  beforeEach(() => {
    memory = Object.assign(createInMemoryDb(), { databaseName: "ahd_sim_credibility_test" });
    db = memory as unknown as Db;
    memory.seed("gameState", [{ _id: "current", currentTurn: 3, currentYear: 2027 }]);
    memory.seed("centralBanks", [
      {
        _id: "US",
        countryId: "US",
        primeRate: 3,
        chairInfamy: 20,
        resolveStreak: 2,
        chairCharacterId: "private-character",
        chairNppId: "private-npp",
        rateHistory: [{ changedByName: "private-name" }],
      },
      { _id: "FR", countryId: "FR", monetaryAuthorityId: "ECB", primeRate: 4 },
    ]);
    memory.seed("federalBudget", [
      { _id: getNationalBudgetId("US"), economicFactors: { inflationRate: 2 } },
      { _id: getNationalBudgetId("FR"), economicFactors: { inflationRate: NaN } },
    ]);
    memory.seed("macroMetrics", [
      { _id: getNationalDocId("US"), economic: { gdpGrowth: { value: 2 } } },
    ]);
  });

  it("records projected end-of-turn state without leaking office-holder identities", async () => {
    await captureCentralBankCredibilityTurn(db, input);
    const points = memory.collection("simCentralBankCredibility").docs;
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({
      _id: "credibility:3:US",
      schemaVersion: 1,
      ...input,
      sourceClass: "sandbox",
      observation: "completed-turn-state",
      observedAt: expect.any(String),
      year: 2027,
      bankId: "US",
      countryId: "US",
      monetaryAuthorityId: null,
      endPrimeRatePct: 3,
      scrutiny: 20,
      resolveStreak: 2,
      countryInflationPct: 2,
      nationalGdpGrowthPct: 2,
    });
    expect(JSON.stringify(points)).not.toContain("private-");
    expect(points[1]).toMatchObject({
      countryId: "FR",
      monetaryAuthorityId: "ECB",
      countryInflationPct: null,
      nationalGdpGrowthPct: null,
      scrutiny: null,
      resolveStreak: null,
    });
  });

  it("preserves first observations when a completed-turn capture is retried", async () => {
    await captureCentralBankCredibilityTurn(db, input);
    await memory.collection("centralBanks").updateOne({ _id: "US" }, { $set: { chairInfamy: 99 } });
    await captureCentralBankCredibilityTurn(db, input);
    const points = memory.collection("simCentralBankCredibility").docs;
    expect(points).toHaveLength(2);
    expect(points[0].scrutiny).toBe(20);
  });

  it.each(["game", "singleplayer", "ahd_sim_"])(
    "rejects non-sandbox database %s before any read",
    async (databaseName) => {
      memory.databaseName = databaseName;
      const collection = vi.spyOn(memory, "collection");
      await expect(captureCentralBankCredibilityTurn(db, input)).rejects.toThrow(/sandbox-only/);
      expect(collection).not.toHaveBeenCalled();
    }
  );

  it.each([
    { codeVersion: "branch-name" },
    { turn: -1 },
    { turn: 3.5 },
    { runId: "" },
    { seed: "" },
  ])("rejects an invalid evidence identity %j", async (override) => {
    await expect(captureCentralBankCredibilityTurn(db, { ...input, ...override })).rejects.toThrow(
      /pinned source, run and turn/
    );
    expect(memory.collections.has("simCentralBankCredibility")).toBe(false);
  });

  it("rejects a mismatched turn before writing any evidence", async () => {
    await expect(captureCentralBankCredibilityTurn(db, { ...input, turn: 4 })).rejects.toThrow(
      /turn mismatch/
    );
    expect(memory.collections.has("simCentralBankCredibility")).toBe(false);
  });

  it("rejects an empty bank population", async () => {
    memory.collection("centralBanks").docs.length = 0;
    await expect(captureCentralBankCredibilityTurn(db, input)).rejects.toThrow(/no observed banks/);
  });

  it("requires both inflation and chair processing to complete", () => {
    expect(() =>
      assertCredibilityPhasesCompleted({
        phaseStatuses: {
          inflationRecalc: { status: "completed" },
          centralBankChairTurn: { status: "completed" },
        },
      })
    ).not.toThrow();
    for (const status of ["failed", "skipped", "pending"]) {
      expect(() =>
        assertCredibilityPhasesCompleted({
          phaseStatuses: {
            inflationRecalc: { status: "completed" },
            centralBankChairTurn: { status },
          },
        })
      ).toThrow(/centralBankChairTurn/);
    }
    expect(() => assertCredibilityPhasesCompleted(null)).toThrow(/inflationRecalc/);
  });
});
