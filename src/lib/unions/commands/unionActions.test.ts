import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, CorporateSector, Union } from "@/lib/db/types";
import {
  endorseBill,
  setUnionDues,
  setUnionServices,
  setUnionWageDemand,
} from "./unionActions";
import { MAX_DUES_FRACTION_OF_WAGE, maxDuesForWage } from "@/lib/unions/unionDues";
import { annualWageFromDaily } from "@/lib/unions/unionServices";

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

  it("setUnionDues returns 403 with the banned message while the union's country has unionsBanned", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);

    const result = await setUnionDues(bannedDb(union, true), character, union._id.toString(), 10);
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

    const result = await setUnionWageDemand(db, character, union._id.toString(), 1.2);
    expect(result.ok).toBe(true);
  });
});

/** A single represented sector earning a known annual wage, for dues-clamp math. */
function makeSector(overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    workers: 1000,
    unionization: 100, // all 1000 workers are members
    wagePerWorker: 10, // daily
    ...overrides,
  } as unknown as CorporateSector;
}

function duesDb(union: Union, sectors: CorporateSector[], updateOne = vi.fn().mockResolvedValue({})) {
  return {
    updateOne,
    db: {
      collection: (name: string) => {
        if (name === "unions") return { findOne: vi.fn().mockResolvedValue(union), updateOne };
        if (name === "federalBudget") {
          return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
        }
        if (name === "corporateSectors") {
          return { find: () => ({ toArray: async () => sectors }) };
        }
        throw new Error(`unexpected collection ${name}`);
      },
    } as unknown as Db,
  };
}

describe("setUnionDues", () => {
  it("clamps a rate above the wage-based ceiling down to maxDuesForWage", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sectors = [makeSector()];
    const annualWage = annualWageFromDaily(10);
    const max = maxDuesForWage(annualWage);
    const { db, updateOne } = duesDb(union, sectors);

    const result = await setUnionDues(db, character, union._id.toString(), max * 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duesPerWorkerAnnual).toBeCloseTo(max, 6);
    expect(result.duesPerWorkerAnnual).toBeCloseTo(annualWage * MAX_DUES_FRACTION_OF_WAGE, 6);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.duesPerWorkerAnnual).toBeCloseTo(max, 6);
  });

  it("rejects a negative or non-finite rate", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db } = duesDb(union, [makeSector()]);

    const negative = await setUnionDues(db, character, union._id.toString(), -1);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.status).toBe(400);

    const nonFinite = await setUnionDues(db, character, union._id.toString(), Number.POSITIVE_INFINITY);
    expect(nonFinite.ok).toBe(false);
  });

  it("passes a within-range rate through unchanged", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const sectors = [makeSector()];
    const annualWage = annualWageFromDaily(10);
    const modestRate = annualWage * 0.02; // well under the 10% ceiling
    const { db } = duesDb(union, sectors);

    const result = await setUnionDues(db, character, union._id.toString(), modestRate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duesPerWorkerAnnual).toBeCloseTo(modestRate, 6);
  });

  it("rejects a character who does not lead this union", async () => {
    const character = makeCharacter();
    const union = makeUnion(new ObjectId());
    const { db } = duesDb(union, []);

    const result = await setUnionDues(db, character, union._id.toString(), 100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});

describe("setUnionServices", () => {
  it("drops unknown service ids rather than storing them", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, updateOne } = duesDb(union, [makeSector()]);

    const result = await setUnionServices(db, character, union._id.toString(), [
      "healthFund",
      "not-a-real-service",
      "healthFund", // duplicate, also collapsed
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activeServices).toEqual(["healthFund"]);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.activeServices).toEqual(["healthFund"]);
  });

  it("an empty slate is valid and costs nothing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db } = duesDb(union, [makeSector()]);

    const result = await setUnionServices(db, character, union._id.toString(), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activeServices).toEqual([]);
    expect(result.servicesCostPerTurn).toBe(0);
  });
});
