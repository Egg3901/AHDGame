import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { replaceFounder } from "./replaceFounder";

interface CharterShape {
  _id: ObjectId;
  countryId: string;
  status: string;
  foundersCharacterIds: ObjectId[];
  signatures: Array<{ characterId: ObjectId; signedAt?: Date; rejectedAt?: Date }>;
}

interface StubCharacter {
  _id: ObjectId;
  userId: ObjectId | null;
  countryId: string;
  homeState?: string | null;
}

interface StubOpts {
  initial: CharterShape | null;
  /** Replacement-character lookup result. `null` simulates not-found. */
  replacementCharacter?: StubCharacter | null;
  /** Anchor-founder (slot 0) lookup result, keyed by its own _id. */
  anchorCharacter?: StubCharacter | null;
  updateMatched?: number;
}

function stubDb(opts: StubOpts) {
  const updateOne = vi.fn().mockResolvedValue({
    matchedCount: opts.updateMatched ?? 1,
    modifiedCount: opts.updateMatched ?? 1,
  });
  const findOneCharter = vi.fn().mockResolvedValue(opts.initial);
  // Route character lookups by _id: the anchor founder's id returns the
  // anchor stub; anything else returns the replacement stub.
  const findOneCharacter = vi.fn().mockImplementation((query: { _id?: ObjectId }) => {
    if (opts.anchorCharacter && query._id?.equals(opts.anchorCharacter._id)) {
      return Promise.resolve(opts.anchorCharacter);
    }
    return Promise.resolve(opts.replacementCharacter ?? null);
  });
  const collection = vi.fn().mockImplementation((name: string) => {
    if (name === "characters") return { findOne: findOneCharacter };
    return { findOne: findOneCharter, updateOne };
  });
  return { db: { collection } as unknown as Db, updateOne, findOneCharter, findOneCharacter };
}

function makeCharter(overrides: Partial<CharterShape> = {}): CharterShape {
  const founders = overrides.foundersCharacterIds ?? [
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
  ];
  return {
    _id: new ObjectId(),
    countryId: "US",
    status: "founder-replacement",
    foundersCharacterIds: founders,
    signatures: founders.map((c) => ({ characterId: c })),
    ...overrides,
  };
}

describe("replaceFounder", () => {
  it("swaps the outgoing founder for the replacement and returns to pending-signatures", async () => {
    const outgoing = new ObjectId();
    const replacement = new ObjectId();
    const founders = [outgoing, new ObjectId(), new ObjectId()];
    const initial = makeCharter({
      foundersCharacterIds: founders,
      signatures: [
        { characterId: outgoing, rejectedAt: new Date() },
        { characterId: founders[1]!, signedAt: new Date() },
        { characterId: founders[2]! },
      ],
    });
    const { db, updateOne } = stubDb({
      initial,
      replacementCharacter: { _id: replacement, userId: new ObjectId(), countryId: "US" },
    });
    const result = await replaceFounder(initial._id, outgoing, replacement, db);
    expect(result).toEqual({ ok: true, status: "pending-signatures" });

    const update = updateOne.mock.calls[0]![1] as { $set: Record<string, unknown> };
    const newFounders = update.$set.foundersCharacterIds as ObjectId[];
    expect(newFounders[0]?.toString()).toBe(replacement.toString());
    expect(newFounders[1]?.toString()).toBe(founders[1]!.toString());
    const newSigs = update.$set.signatures as Array<{
      characterId: ObjectId;
      signedAt?: Date;
      rejectedAt?: Date;
    }>;
    expect(newSigs[0]?.characterId.toString()).toBe(replacement.toString());
    expect(newSigs[0]?.rejectedAt).toBeUndefined();
    expect(newSigs[0]?.signedAt).toBeUndefined();
    expect(newSigs[1]?.signedAt).toBeInstanceOf(Date);
    expect(update.$set.status).toBe("pending-signatures");
    expect(update.$set.founderReplacementDeadline).toBeNull();
  });

  it("returns charter-not-found when charter doesn't exist", async () => {
    const { db } = stubDb({ initial: null });
    const result = await replaceFounder(new ObjectId(), new ObjectId(), new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "charter-not-found" });
  });

  it("returns not-replaceable when status isn't founder-replacement", async () => {
    const outgoing = new ObjectId();
    const initial = makeCharter({
      status: "pending-signatures",
      foundersCharacterIds: [outgoing, new ObjectId(), new ObjectId()],
    });
    const { db } = stubDb({ initial });
    const result = await replaceFounder(initial._id, outgoing, new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "not-replaceable" });
  });

  it("returns outgoing-not-founder when outgoing character isn't on the charter", async () => {
    const initial = makeCharter();
    const { db } = stubDb({ initial });
    const result = await replaceFounder(initial._id, new ObjectId(), new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "outgoing-not-founder" });
  });

  it("returns replacement-already-founder when replacement is already on the charter", async () => {
    const outgoing = new ObjectId();
    const otherFounder = new ObjectId();
    const initial = makeCharter({
      foundersCharacterIds: [outgoing, otherFounder, new ObjectId()],
    });
    const { db } = stubDb({ initial });
    const result = await replaceFounder(initial._id, outgoing, otherFounder, db);
    expect(result).toEqual({ ok: false, reason: "replacement-already-founder" });
  });

  it("returns replacement-not-found when the replacement character doesn't exist", async () => {
    const outgoing = new ObjectId();
    const initial = makeCharter({
      foundersCharacterIds: [outgoing, new ObjectId(), new ObjectId()],
    });
    const { db } = stubDb({ initial, replacementCharacter: null });
    const result = await replaceFounder(initial._id, outgoing, new ObjectId(), db);
    expect(result).toEqual({ ok: false, reason: "replacement-not-found" });
  });

  it("returns replacement-not-human when the replacement character has no userId", async () => {
    const outgoing = new ObjectId();
    const replacement = new ObjectId();
    const initial = makeCharter({
      foundersCharacterIds: [outgoing, new ObjectId(), new ObjectId()],
    });
    const { db } = stubDb({
      initial,
      replacementCharacter: { _id: replacement, userId: null, countryId: "US" },
    });
    const result = await replaceFounder(initial._id, outgoing, replacement, db);
    expect(result).toEqual({ ok: false, reason: "replacement-not-human" });
  });

  it("returns replacement-wrong-country when the replacement is in a different country", async () => {
    const outgoing = new ObjectId();
    const replacement = new ObjectId();
    const initial = makeCharter({
      countryId: "US",
      foundersCharacterIds: [outgoing, new ObjectId(), new ObjectId()],
    });
    const { db } = stubDb({
      initial,
      replacementCharacter: { _id: replacement, userId: new ObjectId(), countryId: "UK" },
    });
    const result = await replaceFounder(initial._id, outgoing, replacement, db);
    expect(result).toEqual({ ok: false, reason: "replacement-wrong-country" });
  });

  describe("replacement adjacency validation", () => {
    it("rejects a replacement outside the anchor founder's state and adjacency", async () => {
      // Anchor (slot 0) lives in CA; replacement lives in NY (not CA-adjacent).
      const anchor = new ObjectId();
      const outgoing = new ObjectId();
      const replacement = new ObjectId();
      const initial = makeCharter({
        foundersCharacterIds: [anchor, outgoing, new ObjectId()],
      });
      const { db } = stubDb({
        initial,
        anchorCharacter: { _id: anchor, userId: new ObjectId(), countryId: "US", homeState: "CA" },
        replacementCharacter: {
          _id: replacement,
          userId: new ObjectId(),
          countryId: "US",
          homeState: "NY",
        },
      });
      const result = await replaceFounder(initial._id, outgoing, replacement, db);
      expect(result).toEqual({ ok: false, reason: "replacement-not-adjacent" });
    });

    it("accepts a replacement in a state adjacent to the anchor founder's", async () => {
      const anchor = new ObjectId();
      const outgoing = new ObjectId();
      const replacement = new ObjectId();
      const initial = makeCharter({
        foundersCharacterIds: [anchor, outgoing, new ObjectId()],
      });
      const { db } = stubDb({
        initial,
        anchorCharacter: { _id: anchor, userId: new ObjectId(), countryId: "US", homeState: "CA" },
        replacementCharacter: {
          _id: replacement,
          userId: new ObjectId(),
          countryId: "US",
          homeState: "OR",
        },
      });
      const result = await replaceFounder(initial._id, outgoing, replacement, db);
      expect(result).toEqual({ ok: true, status: "pending-signatures" });
    });

    it("validates against the outgoing anchor's state when the anchor itself is replaced", async () => {
      // Slot 0 (the anchor) is the outgoing founder. The replacement must
      // still be in/adjacent to the outgoing anchor's home state.
      const anchor = new ObjectId();
      const replacement = new ObjectId();
      const initial = makeCharter({
        foundersCharacterIds: [anchor, new ObjectId(), new ObjectId()],
      });
      const { db } = stubDb({
        initial,
        anchorCharacter: { _id: anchor, userId: new ObjectId(), countryId: "US", homeState: "CA" },
        replacementCharacter: {
          _id: replacement,
          userId: new ObjectId(),
          countryId: "US",
          homeState: "NY",
        },
      });
      const result = await replaceFounder(initial._id, anchor, replacement, db);
      expect(result).toEqual({ ok: false, reason: "replacement-not-adjacent" });
    });

    it("skips adjacency enforcement when the anchor founder has no homeState (legacy data)", async () => {
      const anchor = new ObjectId();
      const outgoing = new ObjectId();
      const replacement = new ObjectId();
      const initial = makeCharter({
        foundersCharacterIds: [anchor, outgoing, new ObjectId()],
      });
      const { db } = stubDb({
        initial,
        anchorCharacter: { _id: anchor, userId: new ObjectId(), countryId: "US", homeState: null },
        replacementCharacter: {
          _id: replacement,
          userId: new ObjectId(),
          countryId: "US",
          homeState: "NY",
        },
      });
      const result = await replaceFounder(initial._id, outgoing, replacement, db);
      expect(result).toEqual({ ok: true, status: "pending-signatures" });
    });
  });

  it("returns not-replaceable when the F6 status guard fails (race against expireCharters)", async () => {
    const outgoing = new ObjectId();
    const replacement = new ObjectId();
    const initial = makeCharter({
      foundersCharacterIds: [outgoing, new ObjectId(), new ObjectId()],
    });
    const { db } = stubDb({
      initial,
      replacementCharacter: { _id: replacement, userId: new ObjectId(), countryId: "US" },
      updateMatched: 0,
    });
    const result = await replaceFounder(initial._id, outgoing, replacement, db);
    expect(result).toEqual({ ok: false, reason: "not-replaceable" });
  });
});
