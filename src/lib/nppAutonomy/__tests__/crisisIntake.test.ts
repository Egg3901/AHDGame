import { describe, it, expect, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, createAsyncIterableCursor } from "@/lib/test-utils/mockDb";
import type { CrisisEffect } from "@/lib/db/types/crisis";
import { loadCrisisAgendaSignals } from "../crisisIntake";
import { crisisSignalsFromEffects } from "../rules/crisisAgendaSignals";
import { METRIC_TO_DOMAIN } from "@/lib/nppAutonomy/selectNppBill";

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
    const signals = crisisSignalsFromEffects(
      [effect({ metricCategory: "healthcare", metricField: "healthcareAccess" })],
      METRIC_TO_DOMAIN
    );
    expect(signals).toEqual({ healthcare: 1 });
  });

  it("ignores non-metric effects and unmapped metrics", () => {
    const signals = crisisSignalsFromEffects(
      [
        effect({ targetType: "gdpLoss", metricCategory: "economic", metricField: "gdpGrowth" }),
        effect({ metricCategory: "made_up", metricField: "nope" }),
      ],
      METRIC_TO_DOMAIN
    );
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
            scope: "country",
            countryIds: ["IE"],
            startTurn: 50,
            effects: [effect({ metricCategory: "healthcare", metricField: "lifeExpectancy" })],
          },
          {
            status: "active",
            scope: "country",
            countryIds: ["IE"],
            startTurn: 80,
            effects: [effect({ metricCategory: "economic", metricField: "unemploymentRate" })],
          },
        ])
      ),
    } as MockDb["collectionMocks"][string];

    const intake = await loadCrisisAgendaSignals(db as unknown as Db, "IE");
    const find = db.collectionMocks["crises"].find as ReturnType<typeof vi.fn>;
    expect(find.mock.calls[0][1].projection).toEqual({
      status: 1,
      scope: 1,
      countryIds: 1,
      startTurn: 1,
      effects: 1,
      "chain.family": 1,
      "chain.rung": 1,
    });
    expect(intake.signals).toEqual({ healthcare: 1, employment: 1 });
    expect(intake.latestStartTurn).toBe(80);
    expect(Object.keys(intake.effectFingerprintByDomain).sort()).toEqual([
      "employment",
      "healthcare",
    ]);
    expect(intake.effectFingerprintByDomain.healthcare).toContain("-3");
  });

  it("fingerprints live metric magnitudes and chain stage for escalation checks", async () => {
    const db: MockDb = createMockDb();
    const active = {
      status: "active",
      scope: "country",
      countryIds: ["IE"],
      startTurn: 50,
      chain: { family: "test-crisis", rung: 1 },
      effects: [
        effect({ metricCategory: "healthcare", metricField: "healthcareAccess", value: -3 }),
      ],
    };
    db.collectionMocks["crises"] = {
      ...db.collection("crises"),
      find: vi.fn().mockReturnValue(createAsyncIterableCursor([active])),
    } as MockDb["collectionMocks"][string];
    const first = await loadCrisisAgendaSignals(db as unknown as Db, "IE");
    db.collectionMocks["crises"] = {
      ...db.collection("crises"),
      find: vi.fn().mockReturnValue(
        createAsyncIterableCursor([
          {
            ...active,
            chain: { family: "test-crisis", rung: 2 },
            effects: [
              effect({ metricCategory: "healthcare", metricField: "healthcareAccess", value: -6 }),
            ],
          },
        ])
      ),
    } as MockDb["collectionMocks"][string];
    const escalated = await loadCrisisAgendaSignals(db as unknown as Db, "IE");
    expect(escalated.signals).toEqual(first.signals);
    expect(escalated.effectFingerprintByDomain.healthcare).not.toBe(
      first.effectFingerprintByDomain.healthcare
    );
  });

  it("returns empty signals when there are no active crises", async () => {
    const db: MockDb = createMockDb();
    db.collection("crises");
    const intake = await loadCrisisAgendaSignals(db as unknown as Db, "IE");
    expect(intake.signals).toEqual({});
    expect(intake.latestStartTurn).toBe(0);
  });
});
