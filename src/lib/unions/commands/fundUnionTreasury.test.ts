import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { fundUnionTreasury } from "./fundUnionTreasury";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));

// The funding spend runs standalone here: no replica set in unit tests.
vi.mock("@/lib/db/runWithOptionalTransaction", () => ({
  runWithOptionalTransaction: vi
    .fn()
    .mockImplementation(async (_inside: unknown, fallback: () => Promise<unknown>) => fallback()),
}));

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    name: "President",
    countryId: "US",
    funds: 50_000,
    ...overrides,
  } as unknown as Character;
}

function makeUnion(ownerId: ObjectId | null, overrides: Partial<Union> = {}): Union {
  return {
    _id: new ObjectId(),
    countryId: "US",
    sectorType: "manufacturing",
    name: "United Steelworkers",
    ownerId,
    treasury: 250,
    ...overrides,
  } as unknown as Union;
}

function duplicateKeyError(): Error {
  return Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
}

function fundDb(
  union: Union,
  options: {
    /** Campaign-funds balance is enforced by the $gte filter on the debit leg. */
    preGated?: boolean;
    /** Matched count for the character debit leg (0 models a lost balance race). */
    debitMatched?: number;
    creditModified?: number;
    isProcessing?: boolean;
    receiptsInsertOne?: ReturnType<typeof vi.fn>;
    receiptsFindOne?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const characterUpdate = vi
    .fn()
    .mockResolvedValue({ matchedCount: options.debitMatched ?? 1, modifiedCount: 1 });
  // A lost race still finds the row: guard-rejected, not missing.
  const characterFindOne = vi.fn().mockResolvedValue({ _id: union.ownerId });
  const unionUpdate = vi.fn().mockResolvedValue({
    matchedCount: options.creditModified ?? 1,
    modifiedCount: options.creditModified ?? 1,
  });
  const receiptsInsertOne = options.receiptsInsertOne ?? vi.fn().mockResolvedValue({ insertedId: "key" });
  const receiptsFindOne = options.receiptsFindOne ?? vi.fn().mockResolvedValue(null);
  const receiptsUpdateOne = vi.fn().mockResolvedValue({ matchedCount: 1 });
  const db = {
    collection: (name: string) => {
      if (name === "gameState") {
        return {
          findOne: vi
            .fn()
            .mockResolvedValue(
              options.isProcessing
                ? { isProcessing: true, processingHeartbeatAt: new Date() }
                : { isProcessing: false }
            ),
        };
      }
      if (name === "federalBudget") {
        return { findOne: vi.fn().mockResolvedValue({ unionsBanned: false }) };
      }
      if (name === "unions") {
        return { findOne: vi.fn().mockResolvedValue(union), updateOne: unionUpdate };
      }
      if (name === "characters") {
        return { findOne: characterFindOne, updateOne: characterUpdate };
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
  } as unknown as Db;
  return { db, characterUpdate, characterFindOne, unionUpdate, receiptsInsertOne };
}

describe("fundUnionTreasury", () => {
  it("moves campaign funds into the treasury of the union the caller leads", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { treasury: 250 });
    const { db, unionUpdate } = fundDb(union);

    const result = await fundUnionTreasury(db, character, union._id.toString(), 1_000);

    expect(result).toMatchObject({ ok: true, contributed: 1_000, treasury: 1_250 });
    const [filter, update] = unionUpdate.mock.calls[0];
    // Keyed update: the guard converges a same-key retry instead of crediting twice.
    expect(filter).toMatchObject({ _id: union._id });
    expect(update.$inc).toEqual({ treasury: 1_000 });
  });

  it("debits campaign funds before crediting the union, so the money is never created", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, characterUpdate, unionUpdate } = fundDb(union);

    await fundUnionTreasury(db, character, union._id.toString(), 500);

    expect(characterUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      unionUpdate.mock.invocationCallOrder[0]
    );
    // The debit is the conditional single-document guard, so two concurrent
    // contributions cannot both pass on a stale balance.
    const [debitFilter] = characterUpdate.mock.calls[0];
    expect(debitFilter).toMatchObject({ _id: character._id, funds: { $gte: 500 } });
  });

  it("refuses and spends nothing when the caller cannot afford it", async () => {
    // No in-memory pre-gate: the guarded debit leg is the affordability
    // check, so an unaffordable balance trips the same guard a lost race
    // would. Nothing is credited.
    const character = makeCharacter({ funds: 500 });
    const union = makeUnion(character._id);
    const { db, unionUpdate } = fundDb(union, { debitMatched: 0 });

    const result = await fundUnionTreasury(db, character, union._id.toString(), 999_999);

    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(unionUpdate).not.toHaveBeenCalled();
  });

  it("reports a shortfall when a concurrent spend wins the balance race", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    // Affordable at read time, but the guarded debit matches nothing: a
    // concurrent spend drained the balance first.
    const { db, unionUpdate } = fundDb(union, { debitMatched: 0 });

    const result = await fundUnionTreasury(db, character, union._id.toString(), 1_000);

    expect(result).toMatchObject({ ok: false, status: 402 });
    if (!result.ok) expect(result.error).toMatch(/campaign funds/i);
    expect(unionUpdate).not.toHaveBeenCalled();
  });

  it("refunds the debit when the treasury credit matches nothing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, characterUpdate } = fundDb(union, { creditModified: 0 });

    const result = await fundUnionTreasury(db, character, union._id.toString(), 750);

    expect(result).toMatchObject({ ok: false, status: 500 });
    // Compensation reverses the debit prefix: the debit leg plus its keyed
    // inverse, not the legacy bare refund.
    expect(characterUpdate).toHaveBeenCalledTimes(2);
    const [, refund] = characterUpdate.mock.calls[1];
    expect(refund.$inc).toEqual({ funds: 750 });
  });

  it("rejects a character who does not lead this union", async () => {
    const character = makeCharacter();
    const union = makeUnion(new ObjectId());
    const { db, unionUpdate } = fundDb(union);

    const result = await fundUnionTreasury(db, character, union._id.toString(), 100);

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(unionUpdate).not.toHaveBeenCalled();
  });

  it("rejects a suspended union, matching every other leader action", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { suspended: true });
    const { db, unionUpdate } = fundDb(union);

    expect(await fundUnionTreasury(db, character, union._id.toString(), 100)).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(unionUpdate).not.toHaveBeenCalled();
  });

  it("rejects amounts below the minimum rather than writing a no-op", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, unionUpdate } = fundDb(union);

    for (const amount of [0, 0.4, -50, Number.NaN]) {
      expect(await fundUnionTreasury(db, character, union._id.toString(), amount)).toMatchObject({
        ok: false,
        status: 400,
      });
    }
    expect(unionUpdate).not.toHaveBeenCalled();
  });

  it("floors a fractional amount so the treasury never shows money that vanished", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { treasury: 0 });
    const { db, unionUpdate } = fundDb(union);

    const result = await fundUnionTreasury(db, character, union._id.toString(), 1_000.9);

    expect(result).toMatchObject({ ok: true, contributed: 1_000 });
    expect(unionUpdate.mock.calls[0][1].$inc).toEqual({ treasury: 1_000 });
  });

  it("is rejected while the turn is processing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db } = fundDb(union, { isProcessing: true });

    expect(await fundUnionTreasury(db, character, union._id.toString(), 100)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("replays the stored outcome when the same key and contribution retry", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const contribution = 1_000;
    const fingerprint = `fund:${character._id.toHexString()}:${union._id.toHexString()}:${contribution}`;
    const { db, characterUpdate } = fundDb(union, {
      receiptsInsertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
      receiptsFindOne: vi
        .fn()
        .mockResolvedValue({ _id: "retry-key", status: "completed", fingerprint }),
    });

    const result = await fundUnionTreasury(db, character, union._id.toString(), contribution, {
      idempotencyKey: "retry-key",
    });

    expect(result).toMatchObject({ ok: true, contributed: 1_000 });
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("rejects a key reused for a different contribution", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, characterUpdate } = fundDb(union, {
      receiptsInsertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
      receiptsFindOne: vi
        .fn()
        .mockResolvedValue({ _id: "used-key", status: "completed", fingerprint: "fund:other" }),
    });

    const result = await fundUnionTreasury(db, character, union._id.toString(), 1_000, {
      idempotencyKey: "used-key",
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toMatch(/already used for a different/i);
    expect(characterUpdate).not.toHaveBeenCalled();
  });

  it("fails closed when the key already settled without completing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const contribution = 1_000;
    const fingerprint = `fund:${character._id.toHexString()}:${union._id.toHexString()}:${contribution}`;
    const { db, characterUpdate } = fundDb(union, {
      receiptsInsertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
      receiptsFindOne: vi.fn().mockResolvedValue({
        _id: "settled-key",
        status: "failed",
        fingerprint,
        error: "UNION_FUND_DEBIT_INSUFFICIENT:guard-rejected",
      }),
    });

    const result = await fundUnionTreasury(db, character, union._id.toString(), contribution, {
      idempotencyKey: "settled-key",
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    if (!result.ok) expect(result.error).toMatch(/already settled/i);
    expect(characterUpdate).not.toHaveBeenCalled();
  });
});
