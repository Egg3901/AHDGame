import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CountryId } from "@/lib/constants/countries";
import { GET } from "./route";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIdsFromDb: vi.fn() }));
vi.mock("@/lib/publicApi/middleware", () => ({ publicApiGuard: vi.fn() }));
vi.mock("@/lib/publicApi/market", () => ({ queryLeaderboard: vi.fn() }));

describe("GET /api/public/v1/leaderboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function setup({
    enabledCountries = ["US", "UK", "DE"] as CountryId[],
  } = {}) {
    const { publicApiGuard } = await import("@/lib/publicApi/middleware");
    const { getEnabledCountryIdsFromDb } = await import("@/lib/countryAccess");
    const { getDb } = await import("@/lib/mongodb");
    const { queryLeaderboard } = await import("@/lib/publicApi/market");

    vi.mocked(publicApiGuard).mockResolvedValue({
      ok: true,
      headers: { "X-RateLimit-Limit": "100" },
    } as never);
    vi.mocked(getEnabledCountryIdsFromDb).mockResolvedValue(enabledCountries);
    vi.mocked(queryLeaderboard).mockResolvedValue({
      found: true,
      metric: "npi",
      characters: [],
    });
    vi.mocked(getDb).mockResolvedValue({ collection: vi.fn() } as never);

    return { publicApiGuard, getEnabledCountryIdsFromDb, queryLeaderboard, getDb };
  }

  it("rejects an invalid country code with 400", async () => {
    await setup();

    const res = await GET(new Request("http://localhost/api/public/v1/leaderboard?country=xx"));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.code).toBe("INVALID_COUNTRY");
  });

  it("rejects an invalid metric with 400", async () => {
    await setup();

    const res = await GET(
      new Request("http://localhost/api/public/v1/leaderboard?country=us&metric=foobar")
    );
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.code).toBe("INVALID_METRIC");
  });

  it("returns empty results for a disabled country", async () => {
    const { queryLeaderboard } = await setup({ enabledCountries: ["US"] });

    const res = await GET(new Request("http://localhost/api/public/v1/leaderboard?country=de"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.found).toBe(false);
    expect(queryLeaderboard).not.toHaveBeenCalled();
  });

  it("passes validated params to queryLeaderboard", async () => {
    const { queryLeaderboard } = await setup();

    const res = await GET(
      new Request("http://localhost/api/public/v1/leaderboard?country=de&metric=funds&limit=5")
    );

    expect(res.status).toBe(200);
    expect(queryLeaderboard).toHaveBeenCalledWith(expect.anything(), {
      country: "DE",
      metric: "funds",
      limit: 5,
    });
  });
});
