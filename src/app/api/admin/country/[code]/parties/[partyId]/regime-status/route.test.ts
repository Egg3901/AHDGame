import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ ok: true, user: { userId: "admin" } }),
}));
vi.mock("@/lib/onePartyState/banFlow", () => ({
  processBanPartyEffects: vi.fn().mockResolvedValue({ officialsVacated: 2, seatsVacated: 5 }),
  processUnbanPartyEffects: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "./route";
import { getDb } from "@/lib/mongodb";
import { processBanPartyEffects, processUnbanPartyEffects } from "@/lib/onePartyState/banFlow";

function makeReq(body: unknown): Request {
  return new Request("http://test/route", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /admin/country/[code]/parties/[partyId]/regime-status", () => {
  let db: MockDb;
  const partyOid = new ObjectId();

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    db.collection("gameState");
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      _id: partyOid,
      sequentialId: 4,
      name: "Test Party",
      countryId: "CN",
      regimeStatus: "approved",
    });
    db.collectionMocks.gameState.findOne.mockResolvedValue({
      _id: "current",
      currentTurn: 100,
    });
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects non-one-party-state countries when setting a real status", async () => {
    const res = await POST(makeReq({ newStatus: "banned", reason: "test" }), {
      params: Promise.resolve({ code: "US", partyId: "4" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects unknown country code", async () => {
    const res = await POST(makeReq({ newStatus: "banned", reason: "test" }), {
      params: Promise.resolve({ code: "ZZ", partyId: "4" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects when party is not found", async () => {
    db.collectionMocks.politicalParties.findOne.mockResolvedValueOnce(null);
    const res = await POST(makeReq({ newStatus: "banned", reason: "test" }), {
      params: Promise.resolve({ code: "CN", partyId: "999" }),
    });
    expect(res.status).toBe(404);
  });

  it("calls processBanPartyEffects when setting status to banned", async () => {
    const res = await POST(makeReq({ newStatus: "banned", reason: "admin action" }), {
      params: Promise.resolve({ code: "CN", partyId: "4" }),
    });
    expect(res.status).toBe(200);
    expect(processBanPartyEffects).toHaveBeenCalled();
    const body = (await res.json()) as {
      impact: { officialsVacated: number };
    };
    expect(body.impact.officialsVacated).toBe(2);
  });

  it("calls processUnbanPartyEffects when going banned -> approved", async () => {
    db.collectionMocks.politicalParties.findOne.mockResolvedValue({
      _id: partyOid,
      sequentialId: 4,
      name: "Test Party",
      countryId: "CN",
      regimeStatus: "banned",
    });
    const res = await POST(makeReq({ newStatus: "approved", reason: "rehabilitated" }), {
      params: Promise.resolve({ code: "CN", partyId: "4" }),
    });
    expect(res.status).toBe(200);
    expect(processUnbanPartyEffects).toHaveBeenCalled();
  });

  it("atomically demotes the existing ruling party when promoting a new one", async () => {
    const oldRulingOid = new ObjectId();
    db.collectionMocks.politicalParties.findOne
      // First call: load target party (approved, going to ruling)
      .mockResolvedValueOnce({
        _id: partyOid,
        sequentialId: 4,
        name: "Test Party",
        countryId: "CN",
        regimeStatus: "approved",
      })
      // Second call: find currently ruling party
      .mockResolvedValueOnce({
        _id: oldRulingOid,
        sequentialId: 1,
        name: "Old Ruling",
        countryId: "CN",
        regimeStatus: "ruling",
      });
    const res = await POST(makeReq({ newStatus: "ruling", reason: "transfer" }), {
      params: Promise.resolve({ code: "CN", partyId: "4" }),
    });
    expect(res.status).toBe(200);
    const updates = db.collectionMocks.politicalParties.updateOne.mock.calls;
    // Old ruling party demoted to "approved"
    const demoteCall = updates.find((c: unknown[]) => {
      const filter = c[0] as { _id?: ObjectId };
      const update = c[1] as { $set?: { regimeStatus?: string } };
      return filter._id?.equals?.(oldRulingOid) && update.$set?.regimeStatus === "approved";
    });
    expect(demoteCall).toBeTruthy();
    // New ruling promoted
    const promoteCall = updates.find((c: unknown[]) => {
      const filter = c[0] as { _id?: ObjectId };
      const update = c[1] as { $set?: { regimeStatus?: string } };
      return filter._id?.equals?.(partyOid) && update.$set?.regimeStatus === "ruling";
    });
    expect(promoteCall).toBeTruthy();
  });

  it("returns 400 for invalid body", async () => {
    const res = await POST(makeReq({ newStatus: "invalid", reason: "x" }), {
      params: Promise.resolve({ code: "CN", partyId: "4" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 when the unique-ruling-party index rejects the promote (E11000 race)", async () => {
    // Simulate a concurrent promote: between this request's demote and
    // promote, another request promoted a different party. The partial
    // unique index `uniq_ruling_party_per_country` rejects our promote
    // with a duplicate-key error.
    const oldRulingOid = new ObjectId();
    db.collectionMocks.politicalParties.findOne
      .mockResolvedValueOnce({
        _id: partyOid,
        sequentialId: 4,
        name: "Test Party",
        countryId: "CN",
        regimeStatus: "approved",
      })
      .mockResolvedValueOnce({
        _id: oldRulingOid,
        sequentialId: 1,
        name: "Old Ruling",
        countryId: "CN",
        regimeStatus: "ruling",
      });
    // First updateOne (demote) succeeds; second updateOne (promote) rejects with E11000
    let updateCallCount = 0;
    db.collectionMocks.politicalParties.updateOne.mockImplementation(async () => {
      updateCallCount++;
      if (updateCallCount === 2) {
        const err: Error & { code?: number } = new Error("E11000 duplicate key error") as Error & {
          code?: number;
        };
        err.code = 11000;
        throw err;
      }
      return { modifiedCount: 1, matchedCount: 1 };
    });

    const res = await POST(makeReq({ newStatus: "ruling", reason: "race transfer" }), {
      params: Promise.resolve({ code: "CN", partyId: "4" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("CONFLICT");
  });
});
