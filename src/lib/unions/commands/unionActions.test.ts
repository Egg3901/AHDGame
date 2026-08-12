import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { recruitForUnion, endorseBill, setUnionWageDemand } from "./unionActions";
import { RECRUIT_COST, applyRecruit } from "@/lib/unions/unionEconomy";

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

describe("endorseBill", () => {
  function endorsementDb(union: Union, bill: { _id: ObjectId } | null) {
    const endorsementUpdate = vi.fn().mockResolvedValue({});
    return {
      endorsementUpdate,
      db: {
        collection: (name: string) => {
          if (name === "unions") return { findOne: vi.fn().mockResolvedValue(union) };
          if (name === "federalBudget") {
            return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
          }
          if (name === "bills") return { findOne: vi.fn().mockResolvedValue(bill) };
          if (name === "unionEndorsements") return { updateOne: endorsementUpdate };
          throw new Error(`unexpected collection ${name}`);
        },
      } as unknown as Db,
    };
  }

  it("rejects a missing, foreign, or finished bill rather than recording a dead stance", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, endorsementUpdate } = endorsementDb(union, null);

    const result = await endorseBill(
      db,
      character,
      union._id.toString(),
      new ObjectId().toString(),
      "endorse"
    );

    expect(result).toMatchObject({ ok: false, status: 404 });
    expect(endorsementUpdate).not.toHaveBeenCalled();
  });

  it("records a stance after the active same-country bill check succeeds", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const billId = new ObjectId();
    const { db, endorsementUpdate } = endorsementDb(union, { _id: billId });

    const result = await endorseBill(
      db,
      character,
      union._id.toString(),
      billId.toString(),
      "oppose"
    );

    expect(result).toMatchObject({ ok: true, stance: "oppose" });
    expect(endorsementUpdate).toHaveBeenCalledWith(
      { unionId: union._id, billId },
      expect.objectContaining({ $set: expect.objectContaining({ stance: "oppose" }) }),
      { upsert: true }
    );
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
