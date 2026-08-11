import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDb = vi.fn();
const mockGetColl = vi.fn();
const mockToArray = vi.fn();

vi.mock("@/lib/mongodb", () => ({ getDb: () => mockGetDb() }));
vi.mock("@/lib/db/collections/countryHistory", () => ({
  getCountryHistoryCollection: (...args: unknown[]) => mockGetColl(...args),
}));

import { GET } from "./route";

function request(): Request {
  return new Request("http://localhost/api/country/CN/parties/5/regime-offers");
}

describe("GET /api/country/[code]/parties/[id]/regime-offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDb.mockResolvedValue({});
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: mockToArray,
    };
    mockGetColl.mockResolvedValue({ find: vi.fn().mockReturnValue(cursor) });
    mockToArray.mockResolvedValue([]);
  });

  it("returns 400 for an unknown country code", async () => {
    const res = await GET(request(), { params: Promise.resolve({ code: "XX", id: "5" }) });
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-numeric party id", async () => {
    const res = await GET(request(), { params: Promise.resolve({ code: "CN", id: "abc" }) });
    expect(res.status).toBe(400);
  });

  it("returns 200 with empty offers array when no events match", async () => {
    const res = await GET(request(), { params: Promise.resolve({ code: "CN", id: "5" }) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { offers: unknown[] };
    expect(json.offers).toEqual([]);
  });

  it("returns shaped offers for matching regime_escalation events", async () => {
    mockToArray.mockResolvedValue([
      {
        turn: 200,
        title: "Party 5 legalized by ruling-party concession",
        timestamp: new Date("2026-05-28"),
        details: { subtype: "selective_concession", bannedPartyId: 5 },
      },
    ]);

    const res = await GET(request(), { params: Promise.resolve({ code: "CN", id: "5" }) });
    const json = (await res.json()) as {
      partyId: string;
      offers: { turn: number; title: string; subtype: string | null }[];
    };
    expect(json.partyId).toBe("5");
    expect(json.offers).toHaveLength(1);
    expect(json.offers[0].subtype).toBe("selective_concession");
    expect(json.offers[0].turn).toBe(200);
  });

  it("does NOT expose ruling-party scalars in the response shape", async () => {
    // Even if the history doc had them (it shouldn't), the route's mapping
    // only forwards turn/title/at/subtype — anything else is dropped.
    mockToArray.mockResolvedValue([
      {
        turn: 200,
        title: "Party 5 legalized by ruling-party concession",
        timestamp: new Date(),
        details: {
          subtype: "selective_concession",
          bannedPartyId: 5,
          popularLegitimacy: 42, // leak attempt
          partyConfidence: 12, // leak attempt
        },
      },
    ]);

    const res = await GET(request(), { params: Promise.resolve({ code: "CN", id: "5" }) });
    const json = (await res.json()) as { offers: Record<string, unknown>[] };
    expect(json.offers[0]).not.toHaveProperty("popularLegitimacy");
    expect(json.offers[0]).not.toHaveProperty("partyConfidence");
    expect(json.offers[0]).not.toHaveProperty("details");
  });
});
