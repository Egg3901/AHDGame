import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { driveConflictTurn } from "./driver";
import type { LivingConflictDef, LivingConflictState } from "./types";

const def: LivingConflictDef = {
  key: "negotiated_driver",
  type: "geopolitical",
  name: "Negotiated Driver",
  autoOpen: true,
  fromYear: 1991,
  participants: { belligerents: [], neighbors: [], blocMembers: [], bystanders: [] },
  roleResolver: () => "bystander",
  tracks: { settlement: { initial: 20 } },
  scheduledPressures: [{ key: "background_talks", everyTurns: 1, trackDeltas: { settlement: 70 } }],
  transitions: [
    {
      key: "agreement",
      fromPhase: "stalemate",
      toPhase: "agreement",
      toStatus: "settled",
      conditions: [{ track: "settlement", min: 80 }],
    },
  ],
  phases: [
    {
      level: 1,
      key: "stalemate",
      label: "Stalemate",
      summary: "No agreement.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
    {
      level: 2,
      key: "agreement",
      label: "Agreement",
      summary: "Agreement reached.",
      advancePressure: 999,
      decisionTrees: {},
      events: [],
    },
  ],
};

function fakeDb(seed?: Partial<LivingConflictState>) {
  const store = new Map<string, unknown>();
  if (seed) store.set(def.key, seed);
  return {
    collection() {
      return {
        async findOne(q: { defKey: string }) {
          return store.get(q.defKey) ?? null;
        },
        async updateOne(q: { defKey: string }, u: { $set: Record<string, unknown> }) {
          store.set(q.defKey, { ...(store.get(q.defKey) ?? {}), ...u.$set });
        },
      };
    },
  } as unknown as Db;
}

describe("negotiated conflict turn driver", () => {
  it("normalizes legacy state, applies scheduled pressure, and resolves a transition", async () => {
    const db = fakeDb({
      defKey: def.key,
      hasOpened: true,
      phaseLevel: 1,
      intensity: 40,
      openedYear: 1991,
      pressure: {},
      phaseTurns: 0,
      totalTurns: 0,
      updatedAt: new Date(0),
    });

    const result = await driveConflictTurn(
      db,
      def,
      { belligerents: [], neighbors: [], blocMembers: [] },
      2,
      1992
    );

    expect(result.state.tracks).toEqual({ settlement: 90 });
    expect(result.state.phaseLevel).toBe(2);
    expect(result.state.status).toBe("settled");
  });

  it("does not advance a closed conflict", async () => {
    const db = fakeDb({
      defKey: def.key,
      hasOpened: true,
      status: "closed",
      phaseLevel: 2,
      intensity: 0,
      openedYear: 1991,
      pressure: {},
      tracks: { settlement: 100 },
      phaseTurns: 9,
      totalTurns: 12,
      updatedAt: new Date(0),
    });

    const result = await driveConflictTurn(
      db,
      def,
      { belligerents: [], neighbors: [], blocMembers: [] },
      13,
      1995
    );

    expect(result.state.phaseTurns).toBe(9);
    expect(result.state.totalTurns).toBe(12);
    expect(result.events).toEqual([]);
  });
});
