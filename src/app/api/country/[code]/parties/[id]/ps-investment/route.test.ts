import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  PS_INVESTMENT_MAX_TIERS,
  psInvestmentRate,
} from "@/lib/turn/politicalStrength/strengthConstants";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));

const NAT_RATE = psInvestmentRate("US", "national");
const MAX_BUDGET = NAT_RATE * PS_INVESTMENT_MAX_TIERS;

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/ps-investment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/ps-investment", () => {
  let db: MockDb;
  let chairId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    chairId = new ObjectId();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

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
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: 1_000_000,
      chairId,
      viceChairId: new ObjectId(),
    } as never);
  });

  it("rejects an invalid country code", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 250_000 }), {
      params: Promise.resolve({ code: "zz", id: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the party is not found", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 250_000 }), {
      params: Promise.resolve({ code: "us", id: "999" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for non-chair / non-vice / non-admin", async () => {
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
    const response = await POST(makeRequest({ budget: 250_000 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(403);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("rejects negative budgets", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: -100 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects budgets above the max-tier cap", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: MAX_BUDGET + 1 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(400);
  });

  it("allows the chair to set a valid budget", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: NAT_RATE }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.psInvestmentBudget).toBe(NAT_RATE);
    // One rate's worth of budget → +1 PS/turn.
    expect(body.expectedPsPerTurn).toBeCloseTo(1);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ psInvestmentBudget: NAT_RATE }),
      })
    );
  });

  it("allows the vice chair to set the budget", async () => {
    const viceChairId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: 1_000_000,
      chairId: new ObjectId(),
      viceChairId,
    } as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "vc",
        isAdmin: false,
        character: { _id: viceChairId, name: "VC" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: MAX_BUDGET }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
  });

  it("allows the national treasurer to set the budget", async () => {
    const treasurerId = new ObjectId();
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
      treasury: 1_000_000,
      chairId: new ObjectId(),
      viceChairId: new ObjectId(),
      treasurerId,
    } as never);

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
    const response = await POST(makeRequest({ budget: 250_000 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
  });

  it("admin override works regardless of party leadership", async () => {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "admin",
        isAdmin: true,
        character: { _id: new ObjectId(), name: "Admin" },
      },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 0 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
  });

  it("accepts budget of 0 (turn investment off)", async () => {
    const { POST } = await import("./route");
    const response = await POST(makeRequest({ budget: 0 }), {
      params: Promise.resolve({ code: "us", id: "1" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.psInvestmentBudget).toBe(0);
    expect(body.expectedPsPerTurn).toBe(0);
  });
});
