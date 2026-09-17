import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { foundUnion } from "./foundUnion";
import { UNION_FOUNDING_ACTION_COST } from "@/lib/unions/unionFounding";

vi.mock("@/lib/campaigns/campaignCurrency", () => ({
  loadCampaignCurrencyRates: vi.fn().mockResolvedValue({ GBP: 2 }),
}));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/db/collections/gameState", () => ({
  getGameStatePresetOrDefault: vi.fn().mockResolvedValue("modern"),
  // rejectIfTurnProcessing reaches getGameState -> getGameStateCollection;
  // without this the module mock silently deletes it and every call throws.
  getGameStateCollection: vi.fn().mockResolvedValue({
    findOne: vi.fn().mockResolvedValue({ isProcessing: false }),
  }),
}));

// The founding spend runs standalone here: no replica set in unit tests.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<unknown>) => fallback()),
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
  // Crash-safe spend (issue #1672): the founding debit is a keyed idempotent
  // leg and the leadership claim a guarded keyed update, both plain
  // `updateOne` calls now (no `findOneAndUpdate`).
  const characterUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const characterFindOne = vi.fn().mockResolvedValue(null);
  const unionsDeleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
  const unionsFindOne = vi.fn().mockResolvedValue(null);
  const unionsFind = vi.fn().mockImplementation(() => ({
    toArray: async () => (options.existingNames ?? []).map((name) => ({ name })),
  }));
  const receiptsInsertOne = vi.fn().mockResolvedValue({ insertedId: "key" });
  const receiptsFindOne = vi.fn().mockResolvedValue(null);
  const receiptsUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });

  return {
    insertOne,
    unionsFind,
    characterUpdateOne,
    characterFindOne,
    unionsDeleteOne,
    receiptsInsertOne,
    db: {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: options.banned ?? false }) };
        }
        if (name === "unions") {
          return {
            find: unionsFind,
            findOne: unionsFindOne,
            insertOne,
            deleteOne: unionsDeleteOne,
          };
        }
        if (name === "characters") {
          return { findOne: characterFindOne, updateOne: characterUpdateOne };
        }
        if (name === "nonAtomicMoneyFlowReceipts") {
          return {
            insertOne: receiptsInsertOne,
            findOne: receiptsFindOne,
            updateOne: receiptsUpdateOne,
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
    // The union `_id` derives from the idempotency key, so the mock's
    // `insertedId` is ignored: the claim must name the row that was actually
    // inserted.
    const insertOne = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const { db, characterUpdateOne } = baseDb({ insertOne });
    const character = makeCharacter();

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Rival Steelworkers",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [insertedDoc] = insertOne.mock.calls[0] as [Union];
    const claimCall = characterUpdateOne.mock.calls.find(
      ([, update]) => update?.$set?.unionLeaderOf != null
    );
    expect(claimCall).toBeDefined();
    expect(claimCall![0]).toMatchObject({ _id: character._id });
    expect(claimCall![1].$set.unionLeaderOf).toEqual(insertedDoc._id);
    expect(result.unionId).toBe((insertedDoc._id as ObjectId).toString());

    // Lost race: the guarded claim matches nothing, the union is deleted and
    // the founder refunded. Only the claim fails: the debit leg lands first.
    const insertOne2 = vi.fn().mockResolvedValue({ insertedId: new ObjectId() });
    const raceDb = baseDb({ insertOne: insertOne2 });
    raceDb.characterUpdateOne.mockImplementation(async (filter: Record<string, unknown>) =>
      "$or" in filter ? { matchedCount: 0, modifiedCount: 0 } : { matchedCount: 1, modifiedCount: 1 }
    );
    const raceResult = await foundUnion(raceDb.db, makeCharacter(), {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Racing Union",
    });
    expect(raceResult.ok).toBe(false);
    if (!raceResult.ok) {
      expect(raceResult.status).toBe(409);
      expect(raceResult.error).toMatch(/already lead a union/i);
    }
    const [raceDoc] = insertOne2.mock.calls[0] as [Union];
    expect(raceDb.unionsDeleteOne).toHaveBeenCalledWith(
      { _id: raceDoc._id, ownerId: expect.anything() },
      undefined
    );
  });

  it("charges campaign funds and action points together in one guarded write", async () => {
    const character = makeCharacter();
    const { db, characterUpdateOne } = baseDb({});

    const result = await foundUnion(db, character, {
      countryId: "US",
      sectorType: "manufacturing",
      name: "Rival Steelworkers",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.actionsSpent).toBe(UNION_FOUNDING_ACTION_COST);
    expect(result.campaignFundsSpent).toBeGreaterThan(0);

    // Personal wealth is never touched: the fee is political spending, and
    // both costs land in ONE guarded money-flow leg.
    const [filter, update] = characterUpdateOne.mock.calls[0];
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
    const { db, insertOne, characterUpdateOne } = baseDb({});

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
    expect(characterUpdateOne).not.toHaveBeenCalled();
    expect(insertOne).not.toHaveBeenCalled();
  });

  it("refuses when action points are short", async () => {
    const character = makeCharacter({
      actions: UNION_FOUNDING_ACTION_COST - 1,
    } as Partial<Character>);
    const { db, insertOne, characterUpdateOne } = baseDb({});

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
    expect(characterUpdateOne).not.toHaveBeenCalled();
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

it("charges the world's fixed campaign base rate rather than modern calibration", async () => {
  const { isForexEnabled } = await import("@/lib/currency/featureFlag");
  vi.mocked(isForexEnabled).mockResolvedValueOnce(true);
  const { db, characterUpdateOne } = baseDb({});
  const result = await foundUnion(db, makeCharacter({ countryId: "UK", funds: 2000000 }), {
    countryId: "UK",
    sectorType: "manufacturing",
    name: "Local Workers",
  });
  expect(result.ok).toBe(true);
  expect(result).toMatchObject({ campaignFundsSpent: 1000000 });
  expect(characterUpdateOne.mock.calls[0][1].$inc.funds).toBe(-1000000);
});
