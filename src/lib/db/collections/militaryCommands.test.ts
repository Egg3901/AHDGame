import { describe, it, expect } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getMilitaryCommands } from "./militaryCommands";

describe("getMilitaryCommands", () => {
  it("returns [] when the country has no commands doc", async () => {
    const db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue(null);
    expect(await getMilitaryCommands(db as unknown as Db, "US")).toEqual([]);
  });

  it("returns the stored commands when present", async () => {
    const db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [{ id: "a", commanderIds: [], commandingGeneralId: null }],
    });
    expect(await getMilitaryCommands(db as unknown as Db, "US")).toEqual([
      { id: "a", commanderIds: [], commandingGeneralId: null },
    ]);
  });

  // Back-compat for commands stored before commandingGeneralId existed. Echoing
  // `undefined` back to the PUT (whose schema requires the field) would 400 every
  // save, so the read path defaults the lead to the first commander — the
  // convention the roster used to render implicitly.
  it("defaults a pre-CG command's lead to its first commander", async () => {
    const db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [{ id: "a", commanderIds: ["g1", "g2"] }],
    });
    const out = await getMilitaryCommands(db as unknown as Db, "US");
    expect(out[0].commandingGeneralId).toBe("g1");
  });

  it("defaults to null when a pre-CG command has no commanders", async () => {
    const db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [{ id: "a", commanderIds: [] }],
    });
    const out = await getMilitaryCommands(db as unknown as Db, "US");
    expect(out[0].commandingGeneralId).toBeNull();
  });

  it("preserves a deliberately leaderless command rather than re-defaulting it", async () => {
    const db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({
      countryId: "US",
      commands: [{ id: "a", commanderIds: ["g1"], commandingGeneralId: null }],
    });
    const out = await getMilitaryCommands(db as unknown as Db, "US");
    expect(out[0].commandingGeneralId).toBeNull();
  });
});

describe("one lead per general, enforced on read", () => {
  async function load(commands: unknown[]) {
    const db = createMockDb();
    db.collection("militaryCommands");
    db.collectionMocks.militaryCommands.findOne.mockResolvedValue({ countryId: "US", commands });
    return getMilitaryCommands(db as unknown as Db, "US");
  }

  it("drops a later command's claim on a general who already leads", async () => {
    // Data saved before the one-command-per-CG rule existed. Echoed back unchanged
    // it would 400 on the next save, leaving the Secretary unable to change
    // anything at all.
    const out = await load([
      { id: "a", commanderIds: ["g1"], commandingGeneralId: "g1" },
      { id: "b", commanderIds: ["g1"], commandingGeneralId: "g1" },
    ]);
    expect(out[0].commandingGeneralId).toBe("g1");
    expect(out[1].commandingGeneralId).toBeNull();
  });

  it("does not let the legacy default manufacture a duplicate", async () => {
    // Two pre-commandingGeneralId commands sharing a first commander would both
    // default their lead to the same general.
    const out = await load([
      { id: "a", commanderIds: ["g1", "g2"] },
      { id: "b", commanderIds: ["g1", "g3"] },
    ]);
    expect(out[0].commandingGeneralId).toBe("g1");
    expect(out[1].commandingGeneralId).toBeNull();
  });

  it("still defaults a legacy lead when there is no clash", async () => {
    const out = await load([
      { id: "a", commanderIds: ["g1"] },
      { id: "b", commanderIds: ["g2"] },
    ]);
    expect(out[0].commandingGeneralId).toBe("g1");
    expect(out[1].commandingGeneralId).toBe("g2");
  });

  it("keeps an explicit null rather than resurrecting a lead", async () => {
    const out = await load([{ id: "a", commanderIds: ["g1"], commandingGeneralId: null }]);
    expect(out[0].commandingGeneralId).toBeNull();
  });

  it("does not collapse two commands that are both explicitly unled", async () => {
    // null is the ordinary state of an unled command; two must not collide.
    const out = await load([
      { id: "a", commanderIds: ["g1"], commandingGeneralId: null },
      { id: "b", commanderIds: ["g2"], commandingGeneralId: null },
    ]);
    expect(out.map((c) => c.commandingGeneralId)).toEqual([null, null]);
  });
});
