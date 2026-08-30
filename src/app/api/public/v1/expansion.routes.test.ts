import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/publicApi/nations", () => ({
  queryCountries: vi.fn(),
  queryCountryRegions: vi.fn(),
  queryCountryBudget: vi.fn(),
}));
vi.mock("@/lib/publicApi/forex", () => ({
  queryForexRates: vi.fn(),
  queryForexCurrency: vi.fn(),
}));
vi.mock("@/lib/publicApi/referendums", () => ({
  queryReferendums: vi.fn(),
  queryReferendum: vi.fn(),
}));

import { GET as getCountries } from "./country/route";
import { GET as getRegions } from "./country/[code]/regions/route";
import { GET as getBudget } from "./country/[code]/budget/route";
import { GET as getForex } from "./forex/route";
import { GET as getForexCurrency } from "./forex/[currency]/route";
import { GET as getReferendums } from "./referendums/route";
import { GET as getReferendum } from "./referendums/[id]/route";

describe("public v1 expansion routes", () => {
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

  it("serves the previously advertised country collection", async () => {
    const { queryCountries } = await import("@/lib/publicApi/nations");
    vi.mocked(queryCountries).mockResolvedValue({ found: true, countries: [] });

    const response = await getCountries(new Request("http://test/api/public/v1/country"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, found: true, countries: [] });
  });

  it("validates region country codes through the query module", async () => {
    const { queryCountryRegions } = await import("@/lib/publicApi/nations");
    vi.mocked(queryCountryRegions).mockResolvedValue(null);

    const response = await getRegions(
      new Request("http://test/api/public/v1/country/XX/regions"),
      { params: Promise.resolve({ code: "XX" }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "INVALID_COUNTRY" });
  });

  it("serves national fiscal data", async () => {
    const { queryCountryBudget } = await import("@/lib/publicApi/nations");
    vi.mocked(queryCountryBudget).mockResolvedValue({ found: true, countryId: "US" } as never);

    const response = await getBudget(
      new Request("http://test/api/public/v1/country/US/budget"),
      { params: Promise.resolve({ code: "US" }) }
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, found: true, countryId: "US" });
  });

  it("serves the forex collection", async () => {
    const { queryForexRates } = await import("@/lib/publicApi/forex");
    vi.mocked(queryForexRates).mockResolvedValue({ found: true, currencies: [] });

    const response = await getForex(new Request("http://test/api/public/v1/forex"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, currencies: [] });
  });

  it("validates currency and history on forex detail", async () => {
    const invalidCurrency = await getForexCurrency(
      new Request("http://test/api/public/v1/forex/NOPE"),
      { params: Promise.resolve({ currency: "NOPE" }) }
    );
    expect(invalidCurrency.status).toBe(400);

    const invalidHistory = await getForexCurrency(
      new Request("http://test/api/public/v1/forex/USD?history=241"),
      { params: Promise.resolve({ currency: "USD" }) }
    );
    expect(invalidHistory.status).toBe(400);
  });

  it("validates and passes referendum collection filters", async () => {
    const { queryReferendums } = await import("@/lib/publicApi/referendums");
    vi.mocked(queryReferendums).mockResolvedValue({ found: false, referendums: [] });

    const invalid = await getReferendums(
      new Request("http://test/api/public/v1/referendums?status=bogus")
    );
    expect(invalid.status).toBe(400);

    const response = await getReferendums(
      new Request("http://test/api/public/v1/referendums?country=uk&status=campaigning&limit=25")
    );
    expect(response.status).toBe(200);
    expect(queryReferendums).toHaveBeenCalledWith(expect.anything(), {
      country: "UK",
      status: "campaigning",
      limit: 25,
    });
  });

  it("returns 404 for a missing referendum detail", async () => {
    const { queryReferendum } = await import("@/lib/publicApi/referendums");
    vi.mocked(queryReferendum).mockResolvedValue(null);

    const response = await getReferendum(
      new Request("http://test/api/public/v1/referendums/missing"),
      { params: Promise.resolve({ id: "missing" }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});
