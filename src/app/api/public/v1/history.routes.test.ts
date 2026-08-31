import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/publicApi/history", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/publicApi/history")>();
  return {
    ...original,
    queryCountryEconomyHistory: vi.fn(),
    queryTradeFlowHistory: vi.fn(),
  };
});

import { GET as getEconomyHistory } from "./country/[code]/economy/history/route";
import { GET as getTradeFlows } from "./trade/flows/route";

describe("public v1 history routes", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDb } = await import("@/lib/mongodb");
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    vi.mocked(getDb).mockResolvedValue({ collection: vi.fn() } as never);
    vi.mocked(publicApiGuard).mockResolvedValue({
      ok: true,
      headers: { "X-RateLimit-Limit": "60" },
    });
  });

  it("validates and forwards the country history range", async () => {
    const { queryCountryEconomyHistory } = await import("@/lib/publicApi/history");
    vi.mocked(queryCountryEconomyHistory).mockResolvedValue({
      found: true,
      countryId: "US",
      countryName: "United States",
      range: { fromTurn: 10, toTurn: 20, limit: 12 },
      series: { primeRate: [], inflation: [], gdpGrowth: [] },
      fiscalYears: [],
    });

    const response = await getEconomyHistory(
      new Request(
        "http://test/api/public/v1/country/US/economy/history?fromTurn=10&toTurn=20&limit=12"
      ),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(response.status).toBe(200);
    expect(queryCountryEconomyHistory).toHaveBeenCalledWith(expect.anything(), "us", {
      fromTurn: 10,
      toTurn: 20,
      limit: 12,
    });
  });

  it("rejects reversed turn ranges", async () => {
    const response = await getEconomyHistory(
      new Request(
        "http://test/api/public/v1/country/US/economy/history?fromTurn=20&toTurn=10"
      ),
      { params: Promise.resolve({ code: "US" }) }
    );
    expect(response.status).toBe(400);
  });

  it("validates trade filters and forwards normalized values", async () => {
    const { queryTradeFlowHistory } = await import("@/lib/publicApi/history");
    vi.mocked(queryTradeFlowHistory).mockResolvedValue({
      found: false,
      monetaryUnit: "anchor",
      filters: { country: "US", commodity: "steel", fromTurn: null, toTurn: null, limit: 24 },
      points: [],
    });

    const invalid = await getTradeFlows(
      new Request("http://test/api/public/v1/trade/flows?commodity=unknown")
    );
    expect(invalid.status).toBe(400);

    const response = await getTradeFlows(
      new Request("http://test/api/public/v1/trade/flows?country=us&commodity=steel&limit=24")
    );
    expect(response.status).toBe(200);
    expect(queryTradeFlowHistory).toHaveBeenCalledWith(expect.anything(), {
      country: "US",
      commodity: "steel",
      fromTurn: undefined,
      toTurn: undefined,
      limit: 24,
    });
  });
});
