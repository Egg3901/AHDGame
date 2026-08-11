import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { signCharter } from "./signCharter";

vi.mock("./ratifyCharter", () => ({
  ratifyCharter: vi.fn().mockResolvedValue({ partyId: "77", partySequentialId: 77 }),
}));

interface CharterShape {
  _id: ObjectId;
  status: string;
  signatures: Array<{ characterId: ObjectId; signedAt?: Date; rejectedAt?: Date }>;
  foundersCharacterIds: ObjectId[];
}

function stubDb(opts: {
  initial: CharterShape;
  postUpdate?: Partial<CharterShape>;
  /** userId that owns the signer character (defaults to a real ObjectId so auth passes). */
  characterOwnerId?: ObjectId;
}) {
  const updateOne = vi.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  let charterReadCount = 0;
  const findOneCharter = vi.fn().mockImplementation(() => {
    charterReadCount += 1;
    return Promise.resolve(
      charterReadCount === 1 ? opts.initial : { ...opts.initial, ...(opts.postUpdate ?? {}) }
    );
  });
  const findOneCharacter = vi
    .fn()
    .mockResolvedValue(opts.characterOwnerId ? { userId: opts.characterOwnerId } : null);

  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") return { findOne: findOneCharacter };
    return { findOne: findOneCharter, updateOne };
  });
  return { db: { collection } as unknown as Db, updateOne, findOneCharter, findOneCharacter };
}

describe("signCharter", () => {
  it("records a signature when caller's character is an unsigned founder (2-of-3)", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const charterId = new ObjectId();
    const ownerId = new ObjectId();
    const initial: CharterShape = {
      _id: charterId,
      status: "pending-signatures",
      signatures: [
        { characterId: founders[0]!, signedAt: new Date() }, // proposer auto-signed
        { characterId: founders[1]! },
        { characterId: founders[2]! },
      ],
      foundersCharacterIds: founders,
    };
    const postUpdate: Partial<CharterShape> = {
      signatures: [
        { characterId: founders[0]!, signedAt: new Date() },
        { characterId: founders[1]!, signedAt: new Date() },
        { characterId: founders[2]! },
      ],
    };
    const { db, updateOne } = stubDb({ initial, postUpdate, characterOwnerId: ownerId });
    const result = await signCharter(charterId, founders[1]!, ownerId, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratified).toBe(false);
    expect(result.signedCount).toBe(2);
    expect(result.requiredCount).toBe(3);
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0]![0]).toMatchObject({
      _id: charterId,
      status: "pending-signatures",
      "signatures.characterId": founders[1]!,
    });
  });

  it("triggers ratification at 3-of-3", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const charterId = new ObjectId();
    const ownerId = new ObjectId();
    const initial: CharterShape = {
      _id: charterId,
      status: "pending-signatures",
      signatures: [
        { characterId: founders[0]!, signedAt: new Date() },
        { characterId: founders[1]!, signedAt: new Date() },
        { characterId: founders[2]! },
      ],
      foundersCharacterIds: founders,
    };
    const postUpdate: Partial<CharterShape> = {
      signatures: [
        { characterId: founders[0]!, signedAt: new Date() },
        { characterId: founders[1]!, signedAt: new Date() },
        { characterId: founders[2]!, signedAt: new Date() },
      ],
    };
    const { db } = stubDb({ initial, postUpdate, characterOwnerId: ownerId });
    const result = await signCharter(charterId, founders[2]!, ownerId, db);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ratified).toBe(true);
    expect(result.signedCount).toBe(3);
    expect(result.ratifiedPartyId).toBe("77");
  });

  it("returns charter-not-found when charter doesn't exist", async () => {
    const findOne = vi.fn().mockResolvedValue(null);
    const collection = vi.fn().mockReturnValue({ findOne });
    const db = { collection } as unknown as Db;
    const result = await signCharter(new ObjectId(), new ObjectId(), new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "charter-not-found" });
  });

  it("returns not-signable when status is not pending-signatures", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "ratified",
      signatures: founders.map((c) => ({ characterId: c, signedAt: new Date() })),
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial });
    const result = await signCharter(initial._id, founders[0]!, new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "not-signable" });
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
    const stranger = new ObjectId();
    const result = await signCharter(initial._id, stranger, new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "not-a-founder" });
  });

  it("returns already-rejected when caller's character previously rejected", async () => {
    const founders = [new ObjectId(), new ObjectId(), new ObjectId()];
    const initial: CharterShape = {
      _id: new ObjectId(),
      status: "pending-signatures",
      signatures: [
        { characterId: founders[0]!, signedAt: new Date() },
        { characterId: founders[1]!, rejectedAt: new Date() },
        { characterId: founders[2]! },
      ],
      foundersCharacterIds: founders,
    };
    const { db } = stubDb({ initial });
    const result = await signCharter(initial._id, founders[1]!, new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "already-rejected" });
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
    const result = await signCharter(initial._id, founders[1]!, someoneElse, db);
    expect(result).toEqual({ ok: false, reason: "not-character-owner" });
  });
});
