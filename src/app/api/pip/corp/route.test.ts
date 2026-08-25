import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/countryAccess", () => ({
  getEnabledCountryIds: vi.fn().mockResolvedValue(["US"]),
}));

vi.mock("@/lib/gameState", () => ({
  getGameState: vi.fn().mockResolvedValue({ currentTurn: 1 }),
}));

vi.mock("@/lib/currency/corporationCapital", () => ({
  // The route ranks corps for display, so it takes the VALUATION map (which
  // backfills an era rate for the bloc currencies the settlement map leaves
  // missing). See lib/currency/valuationFxUsage.test.ts.
  loadValuationFxRates: vi.fn().mockResolvedValue({}),
  resolveCorpLiquidCurrencyCode: vi.fn().mockReturnValue(undefined),
  fxRateForCorpFromMap: vi.fn().mockReturnValue(1),
}));

vi.mock("@/lib/currency/corpEconomyFields", () => ({
  readCorpEconomicAnchor: vi.fn().mockImplementation((value: number) => value),
}));

describe("GET /api/pip/corp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not populate playerCorp for a banned or revoked session", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const charactersFindOne = vi.fn();
    const corporationsFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const collection = vi.fn().mockImplementation((name: string) => {
      if (name === "characters") return { findOne: charactersFindOne };
      if (name === "commodityPrices")
        return { find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }) };
      if (name === "commodityPriceHistory") {
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          }),
        };
      }
      if (name === "corporations") return { find: corporationsFind, findOne: vi.fn() };
      if (name === "corporateSectors") {
        return {
          find: vi.fn().mockReturnValue({
            project: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) }),
          }),
        };
      }
      return { findOne: vi.fn().mockResolvedValue(null) };
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue({ collection } as never);

    const { GET } = await import("./route");
    const response = await GET();

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.playerCorp).toBeNull();
    expect(charactersFindOne).not.toHaveBeenCalled();
  });
});
