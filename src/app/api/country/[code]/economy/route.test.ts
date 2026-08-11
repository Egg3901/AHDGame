import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/economy/queries/countryEconomyOutlook", () => ({
  buildCountryEconomyOutlook: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/country/[code]/economy", () => {
  it("rejects unknown country codes", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/zz/economy"), {
      params: Promise.resolve({ code: "zz" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns the outlook payload for a valid country (case-insensitive)", async () => {
    const { buildCountryEconomyOutlook } =
      await import("@/lib/economy/queries/countryEconomyOutlook");
    vi.mocked(buildCountryEconomyOutlook).mockResolvedValue({
      countryId: "US",
      currentTurn: 412,
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/us/economy"), {
      params: Promise.resolve({ code: "us" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.countryId).toBe("US");
    expect(data.currentTurn).toBe(412);
    expect(vi.mocked(buildCountryEconomyOutlook).mock.calls[0][1]).toBe("US");
  });
});
