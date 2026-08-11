import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  PS_INVESTMENT_MAX_TIERS,
  psInvestmentRate,
} from "@/lib/turn/politicalStrength/strengthConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return {
    ...actual,
    findPartyBySequentialId: vi.fn(),
  };
});
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

const STATE_RATE = psInvestmentRate("US", "state");
const MAX_BUDGET = STATE_RATE * PS_INVESTMENT_MAX_TIERS;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/region/CA/party/1/ps-investment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/region/[id]/party/[partyId]/ps-investment", () => {
  let db: MockDb;
  let stateChairId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("statePartyOrg");
    stateChairId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "stateChair",
        isAdmin: false,
        character: { _id: stateChairId, name: "State Chair" },
      },
    } as never);

    db.collectionMocks["states"]!.findOne.mockResolvedValue({
      _id: "CA",
      name: "California",
    });

    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: stateChairId,
      viceChairId: new ObjectId(),
      treasurerId: new ObjectId(),
    });

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId: new ObjectId(),
    } as never);
  });

  it("rejects an invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 125_000 }), {
      params: Promise.resolve({ code: "zz", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when state is missing", async () => {
    db.collectionMocks["states"]!.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 125_000 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 404 when state party row is missing (no presence)", async () => {
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 125_000 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for an outsider", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "outsider",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Outsider" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 125_000 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(403);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects budgets above the state-tier cap", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: MAX_BUDGET + 1 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("allows the state chair to set a valid budget", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: STATE_RATE * 2 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.psInvestmentBudget).toBe(STATE_RATE * 2);
    // Two rates' worth of budget at the state rate → +2 PS/turn.
    expect(body.expectedPsPerTurn).toBeCloseTo(2);
    expect(db.collectionMocks["statePartyOrg"]!.updateOne).toHaveBeenCalledWith(
      { _id: "CA_1" },
      expect.objectContaining({
        $set: expect.objectContaining({ psInvestmentBudget: STATE_RATE * 2 }),
      })
    );
  });

  it("allows the state treasurer to set the budget", async () => {
    const treasurerId = new ObjectId();
    db.collectionMocks["statePartyOrg"]!.findOne.mockResolvedValue({
      _id: "CA_1",
      stateId: "CA",
      partyId: "1",
      countryId: "US",
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      treasurerId,
    });

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "treas",
        isAdmin: false,
        character: { _id: treasurerId, name: "Treasurer" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 125_000 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
  });

  it("allows the national chair to set the state budget", async () => {
    const nationalChairId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      chairId: nationalChairId,
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "natchair",
        isAdmin: false,
        character: { _id: nationalChairId, name: "Nat Chair" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 0 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(200);
  });

  it("rejects negative budgets", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: -1 }), {
      params: Promise.resolve({ code: "us", id: "CA", partyId: "1" }),
    });
    expect(response.status).toBe(400);
  });
});
