import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, createAsyncIterableCursor } from "@/lib/test-utils/mockDb";
import type { CrisisEffect } from "@/lib/db/types/crisis";
import { crisisSignalsFromEffects, loadCrisisAgendaSignals } from "../crisisIntake";

function effect(over: Partial<CrisisEffect>): CrisisEffect {
  return {
    effectType: "tick",
    targetType: "metric",
    metricCategory: null,
    metricField: null,
    sectorType: null,
    strategyId: null,
    value: -3,
    label: "",
    ...over,
  } as CrisisEffect;
}

describe("crisisSignalsFromEffects (pure)", () => {
  it("maps a metric effect to its agenda domain", () => {
    const signals = crisisSignalsFromEffects([
      effect({ metricCategory: "healthcare", metricField: "healthcareAccess" }),
    ]);
    expect(signals).toEqual({ healthcare: 1 });
  });

  it("ignores non-metric effects and unmapped metrics", () => {
    const signals = crisisSignalsFromEffects([
      effect({ targetType: "gdpLoss", metricCategory: "economic", metricField: "gdpGrowth" }),
      effect({ metricCategory: "made_up", metricField: "nope" }),
    ]);
    expect(signals).toEqual({});
  });
});

describe("loadCrisisAgendaSignals (I/O)", () => {
  it("merges active crisis signals and tracks the latest start turn", async () => {
    const db: MockDb = createMockDb();
    db.collectionMocks["crises"] = {
      ...db.collection("crises"),
      find: vi.fn().mockReturnValue(
        createAsyncIterableCursor([
          {
            status: "active",
            startTurn: 50,
            effects: [effect({ metricCategory: "healthcare", metricField: "lifeExpectancy" })],
          },
          {
            status: "active",
            startTurn: 80,
            effects: [effect({ metricCategory: "economic", metricField: "unemploymentRate" })],
          },
        ])
      ),
    } as MockDb["collectionMocks"][string];

    const intake = await loadCrisisAgendaSignals(db as unknown as Db, "IE");
    expect(intake.signals).toEqual({ healthcare: 1, employment: 1 });
    expect(intake.latestStartTurn).toBe(80);
  });

  it("returns empty signals when there are no active crises", async () => {
    const db: MockDb = createMockDb();
    db.collection("crises");
    const intake = await loadCrisisAgendaSignals(db as unknown as Db, "IE");
    expect(intake.signals).toEqual({});
    expect(intake.latestStartTurn).toBe(0);
  });
});
