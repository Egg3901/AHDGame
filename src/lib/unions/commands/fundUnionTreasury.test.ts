import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { fundUnionTreasury } from "./fundUnionTreasury";

vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn().mockResolvedValue(false) }));

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

function fundDb(
  union: Union,
  options: {
    /** Campaign-funds balance is enforced by the $gte filter on the debit. */
    funded?: boolean;
    creditModified?: number;
    isProcessing?: boolean;
  } = {}
) {
  const characterUpdate = vi
    .fn()
    .mockResolvedValue(options.funded === false ? null : { funds: 40_000 });
  const characterRefund = vi.fn().mockResolvedValue({});
  const unionUpdate = vi.fn().mockResolvedValue({ modifiedCount: options.creditModified ?? 1 });
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
        return { findOneAndUpdate: characterUpdate, updateOne: characterRefund };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  } as unknown as Db;
  return { db, characterUpdate, characterRefund, unionUpdate };
}

describe("fundUnionTreasury", () => {
  it("moves campaign funds into the treasury of the union the caller leads", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id, { treasury: 250 });
    const { db, unionUpdate } = fundDb(union);

    const result = await fundUnionTreasury(db, character, union._id.toString(), 1_000);

    expect(result).toMatchObject({ ok: true, contributed: 1_000, treasury: 1_250 });
    const [filter, update] = unionUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: union._id });
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
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, unionUpdate } = fundDb(union, { funded: false });

    const result = await fundUnionTreasury(db, character, union._id.toString(), 999_999);

    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(unionUpdate).not.toHaveBeenCalled();
  });

  it("refunds the debit when the treasury credit matches nothing", async () => {
    const character = makeCharacter();
    const union = makeUnion(character._id);
    const { db, characterRefund } = fundDb(union, { creditModified: 0 });

    const result = await fundUnionTreasury(db, character, union._id.toString(), 750);

    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(characterRefund).toHaveBeenCalledTimes(1);
    const [, refund] = characterRefund.mock.calls[0];
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
});
