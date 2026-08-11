import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn() }));

function chainFind(rows: Record<string, unknown>[]) {
  return {
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

function aggregateChain(rows: Record<string, unknown>[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
  };
}

describe("GET /api/v1/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setup({ enabledCountries = ["US", "UK", "DE"] as CountryId[] } = {}) {
    const { getAuthUser } = await import("@/lib/auth");
    const { getEnabledCountryIds } = await import("@/lib/countryAccess");
    const { getDb } = await import("@/lib/mongodb");

    vi.mocked(getAuthUser).mockResolvedValue(null);
    vi.mocked(getEnabledCountryIds).mockResolvedValue(enabledCountries);

    vi.mocked(getDb).mockResolvedValue({
      collection: vi.fn().mockImplementation((name: string) => {
        if (name === "characters") {
          return {
            aggregate: vi.fn().mockReturnValue(aggregateChain([])),
            find: vi.fn().mockReturnValue(chainFind([])),
          };
        }
        if (name === "npps") {
          return {
            find: vi.fn().mockReturnValue(chainFind([])),
          };
        }
        if (name === "politicalParties") {
          return {
            find: vi.fn().mockReturnValue(chainFind([])),
          };
        }
        if (name === "states") {
          return {
            find: vi.fn().mockReturnValue(chainFind([])),
          };
        }
        return {};
      }),
    } as never);

    return { getDb, getEnabledCountryIds };
  }

  it("accepts supported country codes beyond US and UK", async () => {
    await setup();

    const res = await GET(new Request("http://localhost/api/v1/leaderboard?country=de&limit=3"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.country).toBe("DE");
  });

  it("normalises lowercase country codes", async () => {
    await setup();

    const res = await GET(new Request("http://localhost/api/v1/leaderboard?country=uk"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.country).toBe("UK");
  });

  it("falls back to US for an invalid country code", async () => {
    await setup();

    const res = await GET(new Request("http://localhost/api/v1/leaderboard?country=xx"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.country).toBe("US");
  });

  it("returns empty results for a disabled country", async () => {
    await setup({ enabledCountries: ["US"] });

    const res = await GET(new Request("http://localhost/api/v1/leaderboard?country=de"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.country).toBe("DE");
    expect(data.entries).toEqual([]);
  });

  it("exposes the country's native currency code so clients can format funds", async () => {
    await setup();

    const us = await (await GET(new Request("http://localhost/api/v1/leaderboard"))).json();
    expect(us.nativeCurrencyCode).toBe("USD");

    const uk = await (
      await GET(new Request("http://localhost/api/v1/leaderboard?country=uk"))
    ).json();
    expect(uk.nativeCurrencyCode).toBe("GBP");
  });

  it("includes nativeCurrencyCode even when the country is disabled", async () => {
    await setup({ enabledCountries: ["US"] });

    const data = await (
      await GET(new Request("http://localhost/api/v1/leaderboard?country=uk"))
    ).json();

    expect(data.entries).toEqual([]);
    expect(data.nativeCurrencyCode).toBe("GBP");
  });
});
