import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { claimCharacterActivation, rememberCharacterActivation } from "./characterActivation";

function fixture() {
  const records = {
    updateOne: vi.fn().mockResolvedValue({}),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
  };
  const state = {
    findOne: vi.fn().mockResolvedValue({ iteration: { type: "beta", number: 2 }, currentTurn: 12 }),
  };
  const db = {
    collection: vi.fn((name: string) => (name === "gameState" ? state : records)),
  } as unknown as Db;
  return { db, records, state };
}

describe("durable character activation", () => {
  it("stores only controlled creation metadata without changing character records", async () => {
    const { db, records } = fixture();
    await rememberCharacterActivation(db, "character-id", {
      createdTurn: 10,
      startingNationId: "US",
      characterCount: 2,
    });
    expect(records.updateOne).toHaveBeenCalledWith(
      { _id: "character-activation:beta-2:character-id" },
      {
        $setOnInsert: {
          value: 10,
          startingNationId: "US",
          creationPath: "character_creator",
          characterCount: 2,
        },
      },
      { upsert: true }
    );
  });
  it("atomically claims once across browsers and scopes the claim to the iteration", async () => {
    const { db, records } = fixture();
    records.findOneAndUpdate.mockResolvedValueOnce({
      value: 10,
      startingNationId: "US",
      creationPath: "character_creator",
      characterCount: 2,
    });
    expect(await claimCharacterActivation(db, "character-id")).toEqual({
      iteration_id: "beta-2",
      turn_number: 12,
      turns_since_character_creation: 2,
      starting_nation_id: "US",
      creation_path: "character_creator",
      character_count: 2,
    });
    expect(await claimCharacterActivation(db, "character-id")).toBeNull();
    expect(records.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "character-activation:beta-2:character-id", claimed: { $ne: true } },
      { $set: { claimed: true } },
      { returnDocument: "before" }
    );
  });
  it("contains optional analytics database failures", async () => {
    const { db, state } = fixture();
    state.findOne.mockRejectedValue(new Error("database unavailable"));
    await expect(
      rememberCharacterActivation(db, "character-id", {
        createdTurn: 10,
        startingNationId: "US",
        characterCount: 1,
      })
    ).resolves.toBeUndefined();
    await expect(claimCharacterActivation(db, "character-id")).resolves.toBeNull();
  });
});
