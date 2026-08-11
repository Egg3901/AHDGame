import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/countryAccess", () => ({
  getAllCountryAccess: vi.fn(),
}));

describe("GET /api/countries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns public country metadata using batched country access", async () => {
    const { getAllCountryAccess } = await import("@/lib/countryAccess");
    // getAllCountryAccess returns only the registered set (COUNTRY_ORDER plus any
    // ACTIVE latent country). Coming-soon SCO/WAL have no active row, so they are
    // absent here — the route iterates these keys, so the response has 8 countries.
    vi.mocked(getAllCountryAccess).mockResolvedValue({
      US: { enabledForPlayers: true, status: "active", economyPreview: false },
      UK: { enabledForPlayers: true, status: "beta", economyPreview: false },
      JP: { enabledForPlayers: false, status: "beta", economyPreview: true },
      DE: { enabledForPlayers: true, status: "active", economyPreview: false },
      IE: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      BR: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      CN: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      NG: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      HU: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      PL: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      RO: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      YU: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      BG: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      BLR: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      CS: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      BAL: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      RU: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      FR: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      IT: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      ES: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      SE: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      TR: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
      DD: { enabledForPlayers: false, status: "coming-soon", economyPreview: false },
    } as Awaited<ReturnType<typeof getAllCountryAccess>>);

    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(getAllCountryAccess).toHaveBeenCalledTimes(1);

    const json = await res.json();
    expect(json.countries).toHaveLength(23);
    expect(json.countries[0]).toMatchObject({
      id: "US",
      status: "active",
      enabledForPlayers: true,
      economyPreview: false,
      entryPath: "/dashboard",
    });
    expect(json.countries[2]).toMatchObject({
      id: "JP",
      status: "beta",
      enabledForPlayers: false,
      economyPreview: true,
      exchangeName: "Nikkei",
    });
    expect(json.countries[7]).toMatchObject({
      id: "NG",
      status: "coming-soon",
      enabledForPlayers: false,
      economyPreview: false,
    });
  });
});
