import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

const mockGetDb = vi.fn();
const mockRequireAuth = vi.fn();
const mockGetCurrentTurn = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: () => mockRequireAuth() }));
vi.mock("@/lib/turn/currentTurn", () => ({
  getCurrentTurn: (...args: unknown[]) => mockGetCurrentTurn(...args),
}));

import { GET } from "./route";

describe("GET /api/character/[id]/sovereign-holdings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({ ok: true });
    mockGetCurrentTurn.mockResolvedValue(1000);
  });

  it("returns 401 when auth fails", async () => {
    mockRequireAuth.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const charId = new ObjectId();
    const params = Promise.resolve({ id: charId.toString() });
    const req = new Request(`http://localhost/api/character/${charId}/sovereign-holdings`);
    const res = await GET(req, { params });
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid character id", async () => {
    const params = Promise.resolve({ id: "not-an-objectid" });
    const req = new Request("http://localhost/api/character/not-an-objectid/sovereign-holdings");
    const res = await GET(req, { params });
    expect(res.status).toBe(400);
  });

  it("returns aggregate by country with face value and demand share", async () => {
    const charId = new ObjectId();
    const usHoldings = {
      _id: new ObjectId(),
      countryId: "US",
      holders: [{ characterId: charId, units: 5000 }],
    };
    const ukHoldings = {
      _id: new ObjectId(),
      countryId: "UK",
      holders: [{ characterId: charId, units: 1000 }],
    };

    mockGetDb.mockResolvedValue({
      collection: (name: string) => {
        if (name === "bonds") {
          return { find: () => ({ toArray: async () => [usHoldings, ukHoldings] }) };
        }
        if (name === "corporations") {
          return { findOne: async () => null };
        }
        if (name === "federalBudget") {
          return { findOne: async () => ({ surplus: -10_000_000_000 }) };
        }
        return { find: () => ({ toArray: async () => [] }), findOne: async () => null };
      },
    });

    const params = Promise.resolve({ id: charId.toString() });
    const req = new Request(`http://localhost/api/character/${charId}/sovereign-holdings`);
    const res = await GET(req, { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toHaveLength(2);
    expect(body.holdings.map((h: { countryCode: string }) => h.countryCode).sort()).toEqual([
      "UK",
      "US",
    ]);
  });
});
