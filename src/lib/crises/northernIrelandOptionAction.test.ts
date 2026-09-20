import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisDecisionOption, CrisisInteraction } from "@/lib/db/types/crisis";
import { runCrisisOptionAction } from "./optionActions";

describe("Northern Ireland option actions", () => {
  it("persists a negotiation choice on the shared living-conflict state", async () => {
    const stores: Record<string, Record<string, unknown>> = {
      livingConflicts: {
        defKey: "northern_ireland",
        hasOpened: true,
        status: "active",
        phaseLevel: 1,
        intensity: 70,
        openedYear: 1991,
        pressure: { a: 0, b: 0 },
        tracks: { settlementMomentum: 18 },
        phaseTurns: 0,
        totalTurns: 0,
      },
      macroMetrics: { _id: "NIR", independenceDesire: { value: 55 } },
      politicalMetrics: { _id: "NIR", values: { "governance.localAutonomy": 40 } },
    };
    const db = {
      collection: (name: string) => ({
        findOne: async () => stores[name] ?? null,
        updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
          const target = stores[name];
          for (const [path, value] of Object.entries(update.$set)) {
            if (path === "independenceDesire.value") {
              (target.independenceDesire as { value: number }).value = value as number;
            } else {
              target[path] = value;
            }
          }
        },
      }),
    } as unknown as Db;
    const option: CrisisDecisionOption = {
      optionId: "open_channel",
      label: "Open a channel",
      description: "",
      effects: [],
      nextNodeId: null,
      action: {
        kind: "livingConflictTrajectory",
        conflictKey: "northern_ireland",
        trackDeltas: { settlementMomentum: 12 },
        nextConflictStatus: "negotiating",
        regionalEffects: {
          regionId: "NIR",
          independenceDesireDelta: -3,
          devolutionSatisfactionDelta: 4,
        },
      },
    };

    await runCrisisOptionAction({
      db,
      crisis: { _id: new ObjectId() } as Crisis,
      interaction: {} as CrisisInteraction,
      option,
      characterId: new ObjectId(),
      countryId: "UK",
      currentTurn: 1,
    });

    const conflict = stores.livingConflicts;
    expect((conflict.tracks as Record<string, number>).settlementMomentum).toBe(30);
    expect(conflict.status).toBe("negotiating");
    expect((stores.macroMetrics.independenceDesire as { value: number }).value).toBe(52);
    expect(
      (stores.politicalMetrics.values as Record<string, number>)["governance.localAutonomy"]
    ).toBe(44);
  });

  it("introduces ratification through the real national bill collection", async () => {
    const insertedBills: Record<string, unknown>[] = [];
    let conflict: Record<string, unknown> = {
      defKey: "northern_ireland",
      hasOpened: true,
      status: "settled",
      phaseLevel: 5,
      intensity: 20,
      openedYear: 1991,
      pressure: { a: 0, b: 0 },
      tracks: { settlementMomentum: 70 },
      phaseTurns: 0,
      totalTurns: 200,
    };
    const db = {
      collection: (name: string) => ({
        findOne: async () =>
          name === "livingConflicts"
            ? conflict
            : name === "characters"
              ? { name: "Prime Minister" }
              : null,
        updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
          if (name === "livingConflicts") conflict = { ...conflict, ...update.$set };
        },
        insertOne: async (doc: Record<string, unknown>) => {
          if (name === "bills") insertedBills.push(doc);
          return { insertedId: new ObjectId() };
        },
      }),
    } as unknown as Db;
    const option: CrisisDecisionOption = {
      optionId: "ratify",
      label: "Ratify",
      description: "",
      effects: [],
      nextNodeId: null,
      action: {
        kind: "livingConflictRatificationBill",
        conflictKey: "northern_ireland",
        title: "Northern Ireland Settlement Bill",
        summary: "Ratifies the settlement.",
        category: "northern_ireland_peace",
        trackDeltas: { settlementMomentum: 8 },
      },
    };

    await runCrisisOptionAction({
      db,
      crisis: { _id: new ObjectId() } as Crisis,
      interaction: {} as CrisisInteraction,
      option,
      characterId: new ObjectId(),
      countryId: "UK",
      currentTurn: 200,
    });

    expect(insertedBills).toHaveLength(1);
    expect(insertedBills[0]).toMatchObject({
      countryId: "UK",
      status: "active",
      category: "northern_ireland_peace",
    });
    expect((conflict.tracks as Record<string, number>).settlementMomentum).toBe(78);
  });
});
