import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { isUnionProsecutionBarred } from "./unionProsecutionBar";

describe("character-wide union prosecution", () => {
  it.each([
    [42, 42, true],
    [42, 43, false],
  ])(
    "checks an organizer bar at turn %i against current turn %i",
    async (barTurn, turn, active) => {
      const characterId = new ObjectId();
      const findBar = vi.fn().mockResolvedValue(active ? { barredUntilTurn: barTurn } : null);
      const db = {
        collection(name: string) {
          if (name === "gameState")
            return { findOne: vi.fn().mockResolvedValue({ currentTurn: turn }) };
          if (name === "unionOrganizers") return { findOne: findBar };
          throw new Error(name);
        },
      } as unknown as Db;
      expect(await isUnionProsecutionBarred(db, characterId)).toBe(active);
      expect(findBar).toHaveBeenCalledWith({
        characterId,
        barredUntilTurn: { $gte: turn },
      });
    }
  );
});
