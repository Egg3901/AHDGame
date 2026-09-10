import { describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { loadOppositionTargets } from "./oppositionTargets";
import type { GameTimeContext } from "@/lib/time/gameTime";
import type { Election } from "@/lib/db/types";

const ME = new ObjectId();
const SAME_PARTY = new ObjectId();
const OTHER_PARTY = new ObjectId();
const ALSO_SAME_PARTY = new ObjectId();

const CANDIDATES = [
  { characterId: ME, characterName: "Ariane Yeong", party: "1", status: "active" },
  { characterId: SAME_PARTY, characterName: "Reginald Lindqvist", party: "1", status: "active" },
  { characterId: ALSO_SAME_PARTY, characterName: "Eleanor Voss", party: "1", status: "active" },
  { characterId: OTHER_PARTY, characterName: "Augustus Okafor", party: "2", status: "active" },
];

function db(rows = CANDIDATES): Db {
  return {
    collection: () => ({ find: () => ({ toArray: vi.fn().mockResolvedValue(rows) }) }),
  } as unknown as Db;
}

const gameTime = (currentTurn: number): GameTimeContext =>
  ({ currentTurn }) as unknown as GameTimeContext;

/** Primary runs turns 1–40, general 40–89, matching a seeded presidential race. */
function election(): Election {
  return {
    _id: new ObjectId(),
    status: "active",
    startTime: null,
    primaryEndTime: null,
    endTime: null,
    startTurn: 1,
    primaryEndTurn: 40,
    endTurn: 89,
  } as unknown as Election;
}

describe("who a campaign may research", () => {
  it("offers only the buyer's own party field during the primary", async () => {
    // A presidential election holds every party's primary at once. A rival in
    // the other party's field is not competing for a single delegate, so
    // draining them costs 8 actions and $40,000 to move nothing in the race the
    // buyer is actually in.
    const targets = await loadOppositionTargets(db(), election(), ME, gameTime(13));
    expect(targets.map((t) => t.name)).toEqual(["Eleanor Voss", "Reginald Lindqvist"]);
  });

  it("offers every other ticket once the general is running", async () => {
    const targets = await loadOppositionTargets(db(), election(), ME, gameTime(50));
    expect(targets.map((t) => t.name)).toEqual([
      "Augustus Okafor",
      "Eleanor Voss",
      "Reginald Lindqvist",
    ]);
  });

  it("never offers the buyer themselves", async () => {
    for (const turn of [13, 50]) {
      const targets = await loadOppositionTargets(db(), election(), ME, gameTime(turn));
      expect(targets.map((t) => t.id)).not.toContain(ME.toString());
    }
  });

  it("sorts by name, so the list does not reshuffle between reads", async () => {
    const targets = await loadOppositionTargets(db(), election(), ME, gameTime(50));
    expect(targets.map((t) => t.name)).toEqual([...targets.map((t) => t.name)].sort());
  });

  it("carries the party, which is what tells two tickets apart in a general", async () => {
    const targets = await loadOppositionTargets(db(), election(), ME, gameTime(50));
    expect(targets.find((t) => t.name === "Augustus Okafor")?.party).toBe("2");
  });

  it("returns nobody when the buyer is unopposed in their field", async () => {
    const solo = CANDIDATES.filter((c) => c.characterId !== SAME_PARTY).filter(
      (c) => c.characterId !== ALSO_SAME_PARTY
    );
    const targets = await loadOppositionTargets(db(solo), election(), ME, gameTime(13));
    expect(targets).toEqual([]);
  });

  it("falls back to the whole field when the buyer is not a candidate", async () => {
    // A manager acting for a campaign whose candidate is not in the roster
    // still gets a usable list rather than an empty one.
    const targets = await loadOppositionTargets(db(), election(), null, gameTime(13));
    expect(targets).toHaveLength(4);
  });
});
