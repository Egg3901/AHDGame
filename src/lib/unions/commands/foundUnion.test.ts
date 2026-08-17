import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { foundUnion } from "./foundUnion";
import { UNION_FOUNDING_ACTION_COST } from "@/lib/unions/unionFounding";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("modern"),
  // rejectIfTurnProcessing reaches getGameState -> getGameStateCollection;
  // without this the module mock silently deletes it and every call throws.
  getGameStateCollection: vi.fn().mockResolvedValue({
    findOne: vi.fn().mockResolvedValue({ isProcessing: false }),
  }),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "Founder",
    countryId: "US",
    funds: 1_000_000,
    actions: 50,
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
  const characterFindOneAndUpdate = vi.fn().mockResolvedValue({ funds: 900_000, actions: 40 });
  const characterUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  const unionsDeleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const unionsFind = vi.fn().mockImplementation(() => ({
    toArray: async () => (options.existingNames ?? []).map((name) => ({ name })),
  }));

  return {
    insertOne,
    unionsFind,
    characterUpdateOne,
    characterFindOneAndUpdate,
    unionsDeleteOne,
    db: {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: options.banned ?? false }) };
        }
        if (name === "unions") {
          return { find: unionsFind, insertOne, deleteOne: unionsDeleteOne };
        }
        if (name === "characters") {
          return {
            findOneAndUpdate: characterFindOneAndUpdate,
            updateOne: characterUpdateOne,
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

  it("rejects a founder who already leads a union", async () => {
    const character = makeCharacter({ unionLeaderOf: new ObjectId() } as Partial<Character>);
    const { db, insertOne } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Second Hat Union",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("claims unionLeaderOf on the founder, guarded, and unwinds a lost race", async () => {
    const insertedId = new ObjectId();
    const insertOne = vi.fn().mockResolvedValue({ insertedId });
    const { db, characterUpdateOne } = baseDb({ insertOne });
    const character = makeCharacter();

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Rival Steelworkers",
    });
    expect(result.ok).toBe(true);
    const claimCall = characterUpdateOne.mock.calls.find(
      ([, update]) => update?.$set?.unionLeaderOf != null
    );
    expect(claimCall).toBeDefined();
    expect(claimCall![1].$set.unionLeaderOf).toEqual(insertedId);

    // Lost race: the guarded claim matches nothing, the union is deleted and
    // the founder refunded.
    const insertedId2 = new ObjectId();
    const insertOne2 = vi.fn().mockResolvedValue({ insertedId: insertedId2 });
    const raceDb = baseDb({ insertOne: insertOne2 });
    raceDb.characterUpdateOne.mockResolvedValue({ modifiedCount: 0 });
    const raceResult = await foundUnion(raceDb.db, makeCharacter(), {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Racing Union",
    });
    expect(raceResult.ok).toBe(false);
    if (!raceResult.ok) expect(raceResult.status).toBe(409);
    expect(raceDb.unionsDeleteOne).toHaveBeenCalledWith({ _id: insertedId2 });
  });

  it("charges campaign funds and action points together in one guarded write", async () => {
    const character = makeCharacter();
    const { db, characterFindOneAndUpdate } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Rival Steelworkers",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actionsSpent).toBe(UNION_FOUNDING_ACTION_COST);
    expect(result.campaignFundsSpent).toBeGreaterThan(0);

    // Personal wealth is never touched: the fee is political spending.
    const [filter, update] = characterFindOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({
      _id: character._id,
      actions: { $gte: UNION_FOUNDING_ACTION_COST },
      funds: { $gte: result.campaignFundsSpent },
    });
    expect(update.$inc.actions).toBe(-UNION_FOUNDING_ACTION_COST);
    expect(update.$inc.funds).toBe(-(result.campaignFundsSpent as number));
    expect(update.$inc).not.toHaveProperty("cashOnHand");
  });

  it("refuses when campaign funds are short, before spending any action points", async () => {
    const character = makeCharacter({ funds: 1 } as Partial<Character>);
    const { db, insertOne, characterFindOneAndUpdate } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Broke Union",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.error).toMatch(/campaign funds/i);
    }
    expect(characterFindOneAndUpdate).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("refuses when action points are short", async () => {
    const character = makeCharacter({
      actions: UNION_FOUNDING_ACTION_COST - 1,
    } as Partial<Character>);
    const { db, insertOne, characterFindOneAndUpdate } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Tired Union",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.error).toMatch(/action points/i);
    }
    expect(characterFindOneAndUpdate).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
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
