import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { foundUnion } from "./foundUnion";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("modern"),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "Founder",
    countryId: "US",
    cashOnHand: 1_000_000,
    ...overrides,
  } as unknown as Character;
}

function gameStateCollection() {
  return { findOne: vi.fn().mockResolvedValue({ isProcessing: false }) };
}

function baseDb(options: {
  existingNames?: string[];
  banned?: boolean;
  insertOne?: ReturnType<typeof vi.fn>;
}) {
  const insertOne = options.insertOne ?? vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
  const characterFindOneAndUpdate = vi.fn().mockResolvedValue({ cashOnHand: 900_000 });
  const unionsFind = vi.fn().mockImplementation(() => ({
    toArray: async () => (options.existingNames ?? []).map((name) => ({ name })),
  }));

  return {
    insertOne,
    unionsFind,
    db: {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: options.banned ?? false }) };
        }
        if (name === "unions") {
          return { find: unionsFind, insertOne };
        }
        if (name === "characters") {
          return {
            findOneAndUpdate: characterFindOneAndUpdate,
            updateOne: vi.fn().mockResolvedValue({}),
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db,
  };
}

describe("foundUnion", () => {
  it("rejects a character founding outside their own country", async () => {
    const character = makeCharacter({ countryId: "US" });
    const { db } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "UK",
      sectorType: "manufacturing",
      name: "British Steelworkers",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects a duplicate name within the same country and industry", async () => {
    const character = makeCharacter();
    const { db } = baseDb({ existingNames: ["United Steelworkers"] });

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "united steelworkers", // case-insensitive match
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.error).toMatch(/already exists/i);
    }
  });

  it("scopes the duplicate check to (countryId, sectorType), so the same name is fine in a different industry", async () => {
    const character = makeCharacter();
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const { db, unionsFind } = baseDb({ existingNames: [], insertOne });

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "agriculture",
      name: "United Steelworkers",
    });
    expect(result.ok).toBe(true);
    expect(unionsFind).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US", sectorType: "agriculture" }),
      expect.anything()
    );
  });

  it("founds a union with zero treasury, base approval, and no represented sectors", async () => {
    const character = makeCharacter();
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const { db } = baseDb({ insertOne });

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Rival Steelworkers",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(insertOne).toHaveBeenCalledTimes(1);
    const [doc] = insertOne.mock.calls[0] as [Union];
    expect(doc.treasury).toBe(0);
    expect(doc.activeServices).toEqual([]);
    expect(doc.foundedByCharacterId).toEqual(character._id);
    expect(doc.ownerId).toEqual(character._id);
    expect(doc.name).toBe("Rival Steelworkers");
  });

  it("rejects a name outside the length bounds", async () => {
    const character = makeCharacter();
    const { db } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "a",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("is blocked while the country has an enacted union ban", async () => {
    const character = makeCharacter();
    const { db } = baseDb({ banned: true });

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Rival Steelworkers",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});
