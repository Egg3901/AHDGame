import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisInteraction } from "@/lib/db/types/crisis";
import type { LivingConflictState } from "./types";

vi.mock("@/lib/crises/featureFlag", () => ({
  isCrisisInteractionEnabled: vi.fn().mockResolvedValue(true),
  isCrisisAidBillsEnabled: vi.fn().mockResolvedValue(false),
}));

import { processLivingConflictsTurn } from "./processTurn";

function pathValue(value: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function equalValue(left: unknown, right: unknown): boolean {
  if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
  return left === right;
}

function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, expected]) => {
    const actual = pathValue(row, key);
    if (expected && typeof expected === "object" && !(expected instanceof ObjectId)) {
      if ("$exists" in expected) return (actual !== undefined) === expected.$exists;
    }
    return equalValue(actual, expected);
  });
}

function fakeDb() {
  const stores = new Map<string, Record<string, unknown>[]>();
  const rows = (name: string) => {
    const found = stores.get(name) ?? [];
    stores.set(name, found);
    return found;
  };
  const db = {
    collection(name: string) {
      return {
        async findOne(query: Record<string, unknown>) {
          return rows(name).find((row) => matches(row, query)) ?? null;
        },
        async insertOne(doc: Record<string, unknown>) {
          const inserted = { ...doc, _id: doc._id ?? new ObjectId() };
          rows(name).push(inserted);
          return { insertedId: inserted._id };
        },
        async updateOne(
          query: Record<string, unknown>,
          update: { $set?: Record<string, unknown> },
          options?: { upsert?: boolean }
        ) {
          let row = rows(name).find((candidate) => matches(candidate, query));
          if (!row && options?.upsert) {
            row = { ...query };
            rows(name).push(row);
          }
          if (!row) return { modifiedCount: 0 };
          Object.assign(row, update.$set ?? {});
          return { modifiedCount: 1 };
        },
      };
    },
  } as unknown as Db;
  return { db, stores };
}

describe("living-conflict turn integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens Vietnam in 1955 as one role-aware crisis and is replay-safe", async () => {
    const { db, stores } = fakeDb();
    const first = await processLivingConflictsTurn(db, 97, 1955, true);
    expect(first.eventsOpened).toBe(1);

    const crisis = stores.get("crises")?.[0] as unknown as Crisis;
    expect(crisis.livingConflictEventId).toBe("vietnam:advisors:97:advisors_entry");
    expect(crisis.globalResponse?.roleByCountry).toMatchObject({
      US: "backer_a",
      RU: "backer_b",
      CN: "neighbor",
      UK: "bloc",
      IE: "bystander",
    });
    expect(crisis.globalResponse?.campaign).toMatchObject({
      stage: "posture",
      cycle: 1,
      consequences: {
        civilianStrain: 0,
        refugees: 0,
        infrastructureDamage: 0,
        armsProliferation: 0,
        regionalSpillover: 0,
        casualties: 0,
        settlementMomentum: 0,
      },
    });
    const interaction = stores.get("crisisInteractions")?.[0] as unknown as CrisisInteraction;
    expect(interaction.decisionTree[0].optionsByRole?.backer_a?.length).toBeGreaterThan(1);
    expect(interaction.decisionDeadline).toBeInstanceOf(Date);

    const stateBefore = {
      ...(stores.get("livingConflicts")?.[0] as unknown as LivingConflictState),
    };
    const replay = await processLivingConflictsTurn(db, 97, 1955, true);
    const stateAfter = stores.get("livingConflicts")?.[0] as unknown as LivingConflictState;
    expect(replay.eventsOpened).toBe(0);
    expect(stateAfter.totalTurns).toBe(stateBefore.totalTurns);
    expect(stateAfter.phaseTurns).toBe(stateBefore.phaseTurns);
  });

  it("materializes non-Vietnam chains through the same crisis interaction path", async () => {
    const { db, stores } = fakeDb();
    await processLivingConflictsTurn(db, 241, 1960, true);
    const crises = (stores.get("crises") ?? []) as unknown as Crisis[];
    const keys = crises.map((crisis) => crisis.globalResponse?.conflictKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        "vietnam",
        "berlin",
        "congo",
        "suez_aftermath",
        "oil_disruption",
        "nuclear_incident",
      ])
    );
    expect(crises.every((crisis) => crisis.interactionDefinition?.decisionTree.length === 1)).toBe(
      true
    );
  });

  it("opens the next consultation on the exact turn the prior window expires", async () => {
    const { db, stores } = fakeDb();
    await processLivingConflictsTurn(db, 97, 1955, true);
    for (let turn = 98; turn <= 121; turn++) {
      await processLivingConflictsTurn(db, turn, 1955, true);
    }

    const vietnamCrises = ((stores.get("crises") ?? []) as unknown as Crisis[]).filter(
      (crisis) => crisis.globalResponse?.conflictKey === "vietnam"
    );
    expect(vietnamCrises.map((crisis) => crisis.startTurn)).toEqual([97, 121]);
    expect(vietnamCrises[1].livingConflictEventId).toContain("advisors_world_response");
  });

  it("imports the live legacy Vietnam rung before opening the 1.3 response", async () => {
    const { db, stores } = fakeDb();
    stores.set("vietnamEscalation", [
      {
        _id: "current",
        hasOpened: true,
        level: 3,
        westSupport: 18,
        eastSupport: 9,
        warTurns: 4,
        westSpend: 100,
        eastSpend: 50,
        updatedAt: new Date(),
      },
    ]);

    await processLivingConflictsTurn(db, 250, 1964, true);
    const vietnam = (stores.get("livingConflicts") ?? []).find(
      (row) => row.defKey === "vietnam"
    ) as unknown as LivingConflictState;
    expect(vietnam.phaseLevel).toBe(3);
    expect(vietnam.pressure).toEqual({ a: 18, b: 9 });
    expect(vietnam.totalTurns).toBe(5);

    const crisis = (stores.get("crises") ?? []).find(
      (row) => row["globalResponse"] && pathValue(row, "globalResponse.conflictKey") === "vietnam"
    ) as unknown as Crisis;
    expect(crisis.livingConflictEventId).toBe("vietnam:tonkin_incident:250:tonkin_incident_entry");
  });
});
