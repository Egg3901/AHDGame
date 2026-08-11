import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/gotv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/gotv", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("partyBudget");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "testuser",
        isAdmin: false,
        character: {
          _id: new ObjectId(),
          name: "Outsider",
        },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: -500,
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    } as never);
  });

  it("does not reset budgets before rejecting an unauthorized caller", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ gotvBudgetPercent: 10 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(403);
    expect(db.collectionMocks["partyBudget"]!.updateMany).not.toHaveBeenCalled();
  });

  it("allows an authorized chair to set GOTV budget when treasury is positive", async () => {
    const chairId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Chair" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: 50000,
      chairId,
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    } as never);

    // No existing budget — fresh upsert path
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ gotvBudgetPercent: 10 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.gotvBudgetPercent).toBe(10);
    expect(db.collectionMocks["partyBudget"]!.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ countryId: "US", partyId: "1", scope: "national" }),
      expect.objectContaining({
        $set: expect.objectContaining({ gotvBudgetPercent: 10, countryId: "US" }),
        $setOnInsert: expect.objectContaining({ partyId: "1", scope: "national" }),
      }),
      { upsert: true }
    );
  });

  it("resets all budgets to 0 and returns 400 when treasury is negative and percent > 0", async () => {
    const chairId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Chair" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: -500,
      chairId,
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    } as never);

    // No budget to reset — resetPartyBudgetSpending returns early
    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ gotvBudgetPercent: 10 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/negative/i);
  });

  it("returns 200 when treasury is negative but percent is 0", async () => {
    const chairId = new ObjectId();

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "chair",
        isAdmin: false,
        character: { _id: chairId, name: "Chair" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: -500,
      chairId,
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    } as never);

    db.collectionMocks["partyBudget"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ gotvBudgetPercent: 0 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });

    expect(response.status).toBe(200);
  });
});
