import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { hasOpenPrivatizationVote, assertCeoTradeNotBlocked } from "./openVoteGuard";

function makeDb(openVoteExists: boolean) {
  return {
    collection: vi.fn().mockReturnValue({
      findOne: vi.fn().mockResolvedValue(openVoteExists ? { _id: new ObjectId() } : null),
    }),
  } as unknown as Db;
}

describe("hasOpenPrivatizationVote", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true when an open vote exists", async () => {
    const db = makeDb(true);
    expect(await hasOpenPrivatizationVote(db, new ObjectId())).toBe(true);
  });

  it("returns false when no open vote exists", async () => {
    const db = makeDb(false);
    expect(await hasOpenPrivatizationVote(db, new ObjectId())).toBe(false);
  });
});

describe("assertCeoTradeNotBlocked", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not block non-CEO traders even with open vote", async () => {
    const db = makeDb(true);
    const ceoId = new ObjectId();
    const otherCharacterId = new ObjectId();
    const corp = { _id: new ObjectId(), ceoId };
    const result = await assertCeoTradeNotBlocked(db, corp, otherCharacterId);
    expect(result.blocked).toBe(false);
  });

  it("does not block CEO trades when no vote is open", async () => {
    const db = makeDb(false);
    const ceoId = new ObjectId();
    const corp = { _id: new ObjectId(), ceoId };
    const result = await assertCeoTradeNotBlocked(db, corp, ceoId);
    expect(result.blocked).toBe(false);
  });

  it("blocks CEO trades when an open vote exists on this corp", async () => {
    const db = makeDb(true);
    const ceoId = new ObjectId();
    const corp = { _id: new ObjectId(), ceoId };
    const result = await assertCeoTradeNotBlocked(db, corp, ceoId);
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.error).toMatch(/cannot trade.*privatization vote/i);
      expect(result.status).toBe(400);
    }
  });
});
