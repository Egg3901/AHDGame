import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, CorporateSector, Union } from "@/lib/db/types";
import { recruitForUnion, callUnionStrike, setUnionWageDemand } from "./unionActions";
import { RECRUIT_COST, applyRecruit, STRIKE_CALL_COST_PER_SECTOR } from "@/lib/unions/unionEconomy";
import { realWageIndex } from "@/lib/labour/unionization";
import { STRIKE_EXPECTATION_GAP_THRESHOLD } from "@/lib/labour/strikes";

vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_withSession: unknown, withoutSession: () => Promise<void>) => {
      return withoutSession();
    }),
}));

vi.mock("@/lib/corporations/sentimentEvents", () => ({
  fireStrikeStartedPulse: vi.fn().mockResolvedValue(undefined),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return { _id: new ObjectId(), name: "TestChar", ...overrides } as unknown as Character;
}

function makeUnion(ownerId: ObjectId | null, overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "United Steelworkers",
    ownerId,
    treasury: 10_000,
    membershipPressure: 20,
    lastCalledStrikeTurn: null,
    demandedWageLevel: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Union;
}

/** gameState collection mock — not processing by default. */
function gameStateCollection(isProcessing = false) {
  return {
    findOne: vi
      .fn()
      .mockResolvedValue(
        isProcessing
          ? { isProcessing: true, processingHeartbeatAt: new Date() }
          : { isProcessing: false }
      ),
  };
}

describe("recruitForUnion", () => {
  it("rejects a character who does not lead this union", async () => {
    const character = makeCharacter();
    const union = makeUnion(new ObjectId()); // different owner
    const db = {
      collection: (name: string) =>
        name === "gameState"
          ? gameStateCollection()
          : { findOne: vi.fn().mockResolvedValue(union) },
    } as unknown as Db;

    const result = await recruitForUnion(db, character, union._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("rejects when the union treasury can't afford the recruit cost", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { treasury: RECRUIT_COST - 1 });
    const db = {
      collection: (name: string) =>
        name === "gameState"
          ? gameStateCollection()
          : { findOne: vi.fn().mockResolvedValue(union) },
    } as unknown as Db;

    const result = await recruitForUnion(db, character, union._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });

  it("rejects while a turn is actively processing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const db = {
      collection: (name: string) =>
        name === "gameState"
          ? gameStateCollection(true)
          : { findOne: vi.fn().mockResolvedValue(union) },
    } as unknown as Db;

    const result = await recruitForUnion(db, character, union._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("succeeds: deducts RECRUIT_COST and raises membershipPressure with diminishing returns", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { treasury: 10_000, membershipPressure: 20 });
    const updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const db = {
      collection: (name: string) =>
        name === "gameState"
          ? gameStateCollection()
          : { findOne: vi.fn().mockResolvedValue(union), updateOne },
    } as unknown as Db;

    const result = await recruitForUnion(db, character, union._id.toString());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cashSpent).toBe(RECRUIT_COST);
    expect(result.membershipPressure).toBe(applyRecruit(20));

    const [filter, update] = updateOne.mock.calls[0];
    expect(filter).toMatchObject({ _id: union._id, treasury: { $gte: RECRUIT_COST } });
    expect(update.$inc.treasury).toBe(-RECRUIT_COST);
  });
});

describe("callUnionStrike", () => {
  function mockStrikeDb({
    matchedSectors,
    unionTreasury = 100_000,
    unionUpdateModifiedCount = 1,
    isProcessing = false,
  }: {
    matchedSectors: Partial<CorporateSector>[];
    unionTreasury?: number;
    unionUpdateModifiedCount?: number;
    isProcessing?: boolean;
  }) {
    const union = makeUnion(new ObjectId(), { treasury: unionTreasury });
    const character = makeCharacter({ _id: union.ownerId! });
    const unionUpdateOne = vi.fn().mockResolvedValue({ modifiedCount: unionUpdateModifiedCount });
    const sectorBulkWrite = vi.fn().mockResolvedValue({});
    const db = {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection(isProcessing);
        // Union-ban gate (player suggestion #93): resolveOwnedUnion checks the
        // country's budget; no ban in these scenarios.
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        }
        if (name === "unions") {
          return { findOne: vi.fn().mockResolvedValue(union), updateOne: unionUpdateOne };
        }
        if (name === "corporateSectors") {
          return {
            find: () => ({ toArray: () => Promise.resolve(matchedSectors) }),
            bulkWrite: sectorBulkWrite,
          };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db;
    return { db, character, union, unionUpdateOne, sectorBulkWrite };
  }

  it("rejects when no sector is organized enough to strike", async () => {
    const { db, character, union } = mockStrikeDb({ matchedSectors: [] });
    const result = await callUnionStrike(db, character, union._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("rejects when the union treasury can't afford the strike cost", async () => {
    const { db, character, union } = mockStrikeDb({
      matchedSectors: [{ _id: new ObjectId() }],
      unionTreasury: STRIKE_CALL_COST_PER_SECTOR - 1,
    });
    const result = await callUnionStrike(db, character, union._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(402);
  });

  it("rejects while in the union-level strike-call cooldown", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { lastCalledStrikeTurn: 5 });
    const db = {
      collection: (name: string) => {
        if (name === "gameState") return gameStateCollection();
        if (name === "federalBudget")
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        if (name === "unions") return { findOne: vi.fn().mockResolvedValue(union) };
        if (name === "corporateSectors")
          return { find: () => ({ toArray: () => Promise.resolve([]) }) };
        throw new Error("unexpected");
      },
    } as unknown as Db;
    const result = await callUnionStrike(db, character, union._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects while a turn is actively processing", async () => {
    const { db, character, union } = mockStrikeDb({
      matchedSectors: [{ _id: new ObjectId() }],
      isProcessing: true,
    });
    const result = await callUnionStrike(db, character, union._id.toString(), 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("succeeds: force-sets strikeStartedAtTurn on matched sectors and deducts scaled cost", async () => {
    const sectorIds = [new ObjectId(), new ObjectId()];
    const { db, character, union, unionUpdateOne, sectorBulkWrite } = mockStrikeDb({
      matchedSectors: sectorIds.map((_id) => ({ _id })),
    });

    const result = await callUnionStrike(db, character, union._id.toString(), 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sectorsStruck).toBe(2);
    expect(result.cashSpent).toBe(2 * STRIKE_CALL_COST_PER_SECTOR);

    const [unionFilter, unionUpdate] = unionUpdateOne.mock.calls[0];
    expect(unionFilter).toMatchObject({ treasury: { $gte: 2 * STRIKE_CALL_COST_PER_SECTOR } });
    expect(unionUpdate.$set.lastCalledStrikeTurn).toBe(10);

    const ops = sectorBulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(2);
    for (const op of ops) {
      expect(op.updateOne.update.$set.strikeStartedAtTurn).toBe(10);
      expect(op.updateOne.update.$set.workerExpectationIndex).toBeGreaterThan(0);
    }
  });

  it("regression: plants a real wage-expectation gap so the forced strike doesn't false-concede next turn", async () => {
    const sectorId = new ObjectId();
    const wageLevel = 1.0;
    const { db, character, union, sectorBulkWrite } = mockStrikeDb({
      matchedSectors: [{ _id: sectorId, wageLevel }],
    });

    await callUnionStrike(db, character, union._id.toString(), 10);

    const ops = sectorBulkWrite.mock.calls[0][0];
    const workerExpectationIndex = ops[0].updateOne.update.$set.workerExpectationIndex;
    const realWage = realWageIndex(wageLevel, undefined);
    const gap = workerExpectationIndex - realWage;
    // Must be strictly greater than the trigger gap threshold — a gap merely
    // equal to it wouldn't itself re-trigger, but more importantly the
    // concession threshold (well below the trigger threshold) must not be
    // met immediately.
    expect(gap).toBeGreaterThan(STRIKE_EXPECTATION_GAP_THRESHOLD);
  });
});

describe("setUnionWageDemand", () => {
  it("clamps the demanded wage level into the standard wage bounds", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const updateOne = vi.fn().mockResolvedValue({});
    const db = {
      collection: () => ({ findOne: vi.fn().mockResolvedValue(union), updateOne }),
    } as unknown as Db;

    const result = await setUnionWageDemand(db, character, union._id.toString(), 5); // way above max
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demandedWageLevel).toBeLessThanOrEqual(1.5);
  });

  it("allows clearing the demand with null", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { demandedWageLevel: 1.2 });
    const updateOne = vi.fn().mockResolvedValue({});
    const db = {
      collection: () => ({ findOne: vi.fn().mockResolvedValue(union), updateOne }),
    } as unknown as Db;

    const result = await setUnionWageDemand(db, character, union._id.toString(), null);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.demandedWageLevel).toBeNull();
  });
});

describe("union ban gate (player suggestion #93)", () => {
  function bannedDb(union: Union, banned: boolean) {
    return {
      collection: (name: string) =>
        name === "gameState"
          ? gameStateCollection()
          : name === "federalBudget"
            ? { findOne: vi.fn().mockResolvedValue({ unionsBanned: banned }) }
            : { findOne: vi.fn().mockResolvedValue(union), updateOne: vi.fn() },
    } as unknown as Db;
  }

  it("recruitForUnion returns 403 with the banned message while the union's country has unionsBanned", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);

    const result = await recruitForUnion(bannedDb(union, true), character, union._id.toString());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/banned under current law/i);
    }
  });

  it("setUnionWageDemand is blocked by the same shared gate", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);

    const result = await setUnionWageDemand(
      bannedDb(union, true),
      character,
      union._id.toString(),
      1.2
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("callUnionStrike is blocked before any treasury/sector work", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);

    const result = await callUnionStrike(
      bannedDb(union, true),
      character,
      union._id.toString(),
      10
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("an explicit unionsBanned: false budget lets actions through the gate", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const db = {
      collection: (name: string) =>
        name === "gameState"
          ? gameStateCollection()
          : name === "federalBudget"
            ? { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) }
            : {
                findOne: vi.fn().mockResolvedValue(union),
                updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
              },
    } as unknown as Db;

    const result = await recruitForUnion(db, character, union._id.toString());
    expect(result.ok).toBe(true);
  });
});
