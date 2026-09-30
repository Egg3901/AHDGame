import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { voteUnionLeader } from "./voteUnionLeader";
import { declineUnionLeadership } from "./declineUnionLeadership";
import { organizeUnion } from "./organizeUnion";

describe("character-wide prosecution on union commands", () => {
  const commands = [
    {
      name: "leadership vote",
      run: (db: Db, character: Character, union: Union) =>
        voteUnionLeader(db, character, union, new ObjectId()),
    },
    {
      name: "declining a leadership offer",
      run: (db: Db, character: Character, union: Union) =>
        declineUnionLeadership(db, character, union),
    },
    {
      name: "legal organizing",
      run: (db: Db, character: Character, union: Union) => organizeUnion(db, character, union),
    },
  ];

  it.each(commands)("blocks $name when prosecution came from another union", async ({ run }) => {
    const character = {
      _id: new ObjectId(),
      countryId: "US",
      actions: 10,
    } as Character;
    const targetUnion = {
      _id: new ObjectId(),
      countryId: "US",
      pendingLeaderCharacterId: character._id,
      strength: 100,
    } as Union;
    const prosecutedUnionId = new ObjectId();
    const findBar = vi.fn().mockResolvedValue({
      unionId: prosecutedUnionId,
      characterId: character._id,
      barredUntilTurn: 45,
    });
    const mutate = vi.fn();
    const db = {
      collection(name: string) {
        if (name === "gameState")
          return { findOne: vi.fn().mockResolvedValue({ currentTurn: 42 }) };
        if (name === "unionOrganizers") return { findOne: findBar, updateOne: mutate };
        if (name === "characters" || name === "unions" || name === "unionLeaderVotes") {
          return { findOne: vi.fn(), updateOne: mutate, findOneAndUpdate: mutate };
        }
        throw new Error(`Unexpected collection: ${name}`);
      },
    } as unknown as Db;

    expect(prosecutedUnionId.equals(targetUnion._id)).toBe(false);
    await expect(run(db, character, targetUnion)).resolves.toEqual({
      ok: false,
      status: 403,
      error: "You are barred from union actions by prosecution.",
    });
    expect(findBar).toHaveBeenCalledWith({
      characterId: character._id,
      barredUntilTurn: { $gte: 42 },
    });
    expect(mutate).not.toHaveBeenCalled();
  });
});
