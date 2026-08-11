import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { rejectCharter } from "./rejectCharter";

interface CharterShape {
  _id: ObjectId;
  status: string;
  signatures: Array<{ characterId: ObjectId; signedAt?: Date; rejectedAt?: Date }>;
  foundersCharacterIds: ObjectId[];
}

function stubDb(opts: {
  initial: CharterShape | null;
  /** userId that owns the rejecter character (null = no owner / character missing). */
  characterOwnerId?: ObjectId | null;
  /** Force updateOne to report 0 matched (lost-race / status guard fail). */
  updateMatched?: number;
}) {
  const updateOne = vi.fn().mockResolvedValue({
    matchedCount: opts.updateMatched ?? 1,
    modifiedCount: opts.updateMatched ?? 1,
  });
  const findOneCharter = vi.fn().mockResolvedValue(opts.initial);
  const findOneCharacter = vi
    .fn()
    .mockResolvedValue(
      opts.characterOwnerId === null
        ? null
        : opts.characterOwnerId
          ? { userId: opts.characterOwnerId }
          : null
    );
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") return { findOne: findOneCharacter };
    return { findOne: findOneCharter, updateOne };
  });
  return { db: { collection } as unknown as Db, updateOne, findOneCharter };
}

describe("rejectCharter", () => {
  it("records a rejection with reason and transitions to founder-replacement", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const ownerId = new ObjectId();
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: founders.map((c, i) =>
        i === 0 ? { characterId: c, signedAt: new Date() } : { characterId: c }
      ),
      foundersCharacterIds: founders,
    };
    const { db, updateOne } = stubDb({ initial, characterOwnerId: ownerId });
    const result = await rejectCharter(
      initial._id,
      founders[1]!,
      ownerId,
      "philosophical disagreement",
      db
    );
    expect(result).toEqual({ ok: true, status: "founder-replacement" });

    const filter = updateOne.mock.calls[0]![0] as Record<string, unknown>;
    const update = updateOne.mock.calls[0]![1] as { $set: Record<string, unknown> };
    expect(filter.status).toBe("pending-signatures");
    expect(filter["signatures.characterId"]).toEqual(founders[1]!);
    expect(update.$set["signatures.$.rejectedAt"]).toBeInstanceOf(Date);
    expect(update.$set["signatures.$.rejectionReason"]).toBe("philosophical disagreement");
    expect(update.$set.status).toBe("founder-replacement");
    expect(update.$set.founderReplacementDeadline).toBeInstanceOf(Date);
  });

  it("omits rejectionReason from $set when reason is undefined", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const ownerId = new ObjectId();
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: founders.map((c) => ({ characterId: c })),
      foundersCharacterIds: founders,
    };
    const { db, updateOne } = stubDb({ initial, characterOwnerId: ownerId });
    await rejectCharter(initial._id, founders[1]!, ownerId, undefined, db);
    const update = updateOne.mock.calls[0]![1] as { $set: Record<string, unknown> };
    expect("signatures.$.rejectionReason" in update.$set).toBe(false);
  });

  it("returns charter-not-found when charter doesn't exist", async () => {
    const { db } = stubDb({ initial: null });
    const result = await rejectCharter(
      new ObjectId(),
      new ObjectId(),
      new ObjectId(),
      undefined,
      db
    );
    expect(result).toEqual({ ok: false, reason: "charter-not-found" });
  });

  it("returns not-rejectable when status isn't pending-signatures", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "ratified",
      signatures: founders.map((c) => ({ characterId: c, signedAt: new Date() })),
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial });
    const result = await rejectCharter(initial._id, founders[0]!, new ObjectId(), undefined, db);
    expect(result).toEqual({ ok: false, reason: "not-rejectable" });
  });

  it("returns not-a-founder when caller's character isn't on the charter", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: founders.map((c) => ({ characterId: c })),
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial });
    const result = await rejectCharter(initial._id, new ObjectId(), new ObjectId(), undefined, db);
    expect(result).toEqual({ ok: false, reason: "not-a-founder" });
  });

  it("returns not-character-owner when the caller's userId doesn't own the character", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const realOwner = new ObjectId();
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: founders.map((c) => ({ characterId: c })),
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial, characterOwnerId: realOwner });
    const someoneElse = new ObjectId();
    const result = await rejectCharter(initial._id, founders[1]!, someoneElse, undefined, db);
    expect(result).toEqual({ ok: false, reason: "not-character-owner" });
  });

  it("returns already-signed when caller's character previously signed", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: [
        { characterId: founders[0]!, signedAt: new Date() },
        { characterId: founders[1]!, signedAt: new Date() },
        { characterId: founders[2]! },
      ],
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial });
    const result = await rejectCharter(initial._id, founders[1]!, new ObjectId(), undefined, db);
    expect(result).toEqual({ ok: false, reason: "already-signed" });
  });

  it("returns not-rejectable when the F6 status guard fails (race against expireCharters)", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const ownerId = new ObjectId();
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: founders.map((c) => ({ characterId: c })),
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial, characterOwnerId: ownerId, updateMatched: 0 });
    const result = await rejectCharter(initial._id, founders[1]!, ownerId, undefined, db);
    expect(result).toEqual({ ok: false, reason: "not-rejectable" });
  });
});
