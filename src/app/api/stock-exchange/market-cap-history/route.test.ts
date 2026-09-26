import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn().mockResolvedValue([]) }));

describe("GET /api/stock-exchange/market-cap-history", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const history = [
      {
        turn: 10,
        createdAt: new Date("2026-09-26T10:00:00.000Z"),
        globalMarketCap: 100,
        bySector: { financial: 40 },
      },
    ];
    const collection = {
      find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => history }) }) }),
    };
    vi.mocked(getDb).mockResolvedValue({ collection: () => collection } as unknown as Db);
  });

  it("includes a valid timestamp and sector values for chart comparisons", async () => {
    const res = await GET(
      new Request("http://localhost/api/stock-exchange/market-cap-history?exchange=global&limit=24")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points[0]).toMatchObject({
      turn: 10,
      createdAt: "2026-09-26T10:00:00.000Z",
      bySector: { financial: 40 },
    });
  });
});
