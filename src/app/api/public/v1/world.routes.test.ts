import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/publicApi/metrics", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/publicApi/metrics")>();
  return { ...original, queryCountryMetrics: vi.fn() };
});
vi.mock("@/lib/publicApi/organizations", () => ({
  queryOrganizations: vi.fn(),
  queryOrganization: vi.fn(),
}));
vi.mock("@/lib/publicApi/trade", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/publicApi/trade")>();
  return { ...original, queryTariffs: vi.fn(), queryTradeEmbargoes: vi.fn() };
});
vi.mock("@/lib/publicApi/sovereigns", () => ({ querySovereignWatch: vi.fn() }));

import { GET as getMetrics } from "./country/[code]/metrics/route";
import { GET as getOrganizations } from "./organizations/route";
import { GET as getOrganization } from "./organizations/[id]/route";
import { GET as getTariffs } from "./trade/tariffs/route";
import { GET as getEmbargoes } from "./trade/embargoes/route";
import { GET as getSovereigns } from "./sovereigns/route";

describe("public v1 world routes", () => {
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

  it("validates metric categories", async () => {
    const response = await getMetrics(
      new Request("http://test/api/public/v1/country/US/metrics?category=unknown"),
      { params: Promise.resolve({ code: "US" }) }
    );
    expect(response.status).toBe(400);
  });

  it("serves organization summaries and returns 404 for missing detail", async () => {
    const { queryOrganizations, queryOrganization } = await import(
      "@/lib/publicApi/organizations"
    );
    vi.mocked(queryOrganizations).mockResolvedValue({
      found: true,
      count: 1,
      organizations: [],
    });
    vi.mocked(queryOrganization).mockResolvedValue(null);

    const collection = await getOrganizations(
      new Request("http://test/api/public/v1/organizations")
    );
    const detail = await getOrganization(
      new Request("http://test/api/public/v1/organizations/missing"),
      { params: Promise.resolve({ id: "missing" }) }
    );

    expect(collection.status).toBe(200);
    expect(await collection.json()).toMatchObject({ ok: true, count: 1 });
    expect(detail.status).toBe(404);
  });

  it("validates tariff filters and passes normalized values", async () => {
    const { queryTariffs } = await import("@/lib/publicApi/trade");
    vi.mocked(queryTariffs).mockResolvedValue({ found: false, count: 0, tariffs: [] });
    const invalid = await getTariffs(
      new Request("http://test/api/public/v1/trade/tariffs?scope=invalid")
    );
    expect(invalid.status).toBe(400);

    const response = await getTariffs(
      new Request(
        "http://test/api/public/v1/trade/tariffs?country=us&targetCountry=uk&scope=sector&limit=25"
      )
    );
    expect(response.status).toBe(200);
    expect(queryTariffs).toHaveBeenCalledWith(expect.anything(), {
      country: "US",
      targetCountry: "UK",
      scope: "sector",
      limit: 25,
    });
  });

  it("validates embargo booleans", async () => {
    const response = await getEmbargoes(
      new Request("http://test/api/public/v1/trade/embargoes?includePending=yes")
    );
    expect(response.status).toBe(400);
  });

  it("serves sovereign monitoring", async () => {
    const { querySovereignWatch } = await import("@/lib/publicApi/sovereigns");
    vi.mocked(querySovereignWatch).mockResolvedValue({
      found: true,
      currentTurn: 10,
      countries: [],
    });
    const response = await getSovereigns(
      new Request("http://test/api/public/v1/sovereigns")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, currentTurn: 10 });
  });
});
