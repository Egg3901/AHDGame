import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { TRAVEL_STATE_IDS, travelStateIds, loadStateTravelOptions } from "./stateTravelOptions";

/** A db whose gameState carries `preset` and whose states collection is empty. */
function stubDb(preset: string | undefined): Db {
  return {
    collection: (name: string) => ({
      findOne: vi.fn().mockResolvedValue(name === "gameState" ? { _id: "current", preset } : null),
      find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
    }),
  } as unknown as Db;
}

describe("travelStateIds", () => {
  it("offers the modern fifty plus DC on a modern world", () => {
    const ids = travelStateIds("2019-default");
    expect(ids).toContain("AK");
    expect(ids).toContain("HI");
    expect(ids).toContain("DC");
  });

  it("drops the states that do not exist on a 1953 world", () => {
    // Alaska and Hawaii were territories and DC had no electoral votes until
    // the 23rd Amendment. Every route behind these pickers validates against
    // the preset's own units, so offering them produced "Invalid US state code"
    // from the server on the live world.
    const ids = travelStateIds("1953-default");
    expect(ids).not.toContain("AK");
    expect(ids).not.toContain("HI");
    expect(ids).not.toContain("DC");
    expect(ids).toContain("IA");
  });

  it("falls back to the modern map when the preset is unknown", () => {
    expect(travelStateIds(undefined).sort()).toEqual([...TRAVEL_STATE_IDS].sort());
  });
});

describe("loadStateTravelOptions", () => {
  it("offers only the states the world's own apportionment has", async () => {
    const { options } = await loadStateTravelOptions(stubDb("1953-default"));
    expect(options.map((o) => o.id)).not.toContain("AK");
  });

  it("still names every modern state, so a name never falls back to a code", async () => {
    // The naming map stays broad on purpose: a candidate can hold presence in a
    // state this preset does not put on the ballot, and it should still read as
    // a place rather than as two letters.
    const { stateNameById } = await loadStateTravelOptions(stubDb("1953-default"));
    expect(Object.keys(stateNameById)).toContain("AK");
  });
});
