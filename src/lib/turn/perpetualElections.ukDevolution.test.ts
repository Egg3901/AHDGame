import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import type { Election } from "@/lib/db/types";
import {
  initialUKDevolutionState,
  type UKDevolutionState,
} from "@/lib/countries/uk/devolution/rules";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/discordWebhooks", () => ({
  sendCountryGameEventMultiple: vi.fn().mockResolvedValue(undefined),
  DISCORD_COLORS: {},
}));

async function run(
  startingYear: number,
  currentTurn: number,
  policy: object | null = null,
  stored: UKDevolutionState | null = null
) {
  const inserted: Election[] = [];
  const db = {
    collection: (name: string) => ({
      findOne: async () =>
        name === "gameState"
          ? { startingYear, preset: "1991-default", currentTurn }
          : name === "statePolicies"
            ? policy
            : name === "ukDevolution"
              ? stored
              : null,
      find: () => ({
        sort() {
          return this;
        },
        toArray: async () =>
          name === "states" ? ["SCO", "WAL", "NIR", "LON"].map((_id) => ({ _id })) : [],
      }),
      updateMany: async () => ({}),
      updateOne: async () => ({}),
      insertMany: async (rows: Election[]) => {
        inserted.push(...rows);
        return { insertedIds: {} };
      },
    }),
  };
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { ensureRegionalGovernorElections } = await import("./perpetualElections/shared");
  await ensureRegionalGovernorElections("UK", new Date("2026-01-01T00:00:00Z"));
  return inserted;
}

describe("UK devolution election lifecycle", () => {
  it("does not spawn premature offices or automatically found them as calendar years pass", async () => {
    expect(await run(1991, 1)).toEqual([]);
    expect(await run(1991, 600, null, initialUKDevolutionState(1991))).toEqual([]);
  });

  it("opens all four executive races after a founding bill with the enacted anchor", async () => {
    const rows = await run(1991, 100, {
      enactedBy: { kind: "bill", id: new ObjectId() },
      policyOptionIndex: 3,
      enactedTurn: 100,
    });
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.state))).toEqual(new Set(["SCO", "WAL", "NIR", "LON"]));
    expect(rows.every((row) => row.cycle === 1 && row.totalSeats === 1)).toBe(true);
    expect(new Set(rows.map((row) => row.endTurn))).toEqual(new Set([172]));
  });
});
