import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Crisis, CrisisDecisionOption, CrisisInteraction } from "@/lib/db/types/crisis";
import { runCrisisOptionAction } from "./optionActions";

describe("Northern Ireland option actions", () => {
  it("persists a negotiation choice on the shared living-conflict state", async () => {
    let stored: Record<string, unknown> | null = {
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
    };
    const db = {
      collection: () => ({
        findOne: async () => stored,
        updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
          stored = { ...(stored ?? {}), ...update.$set };
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

    expect((stored?.tracks as Record<string, number>).settlementMomentum).toBe(30);
    expect(stored?.status).toBe("negotiating");
  });
});
