import { describe, expect, it, vi } from "vitest";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: async () => ["NG"] }));
vi.mock("@/lib/gameState", () => ({
  getGameState: async () => ({ preset: "1953-default", startingYear: 1953, currentTurn: 1 }),
}));
vi.mock("@/lib/country/countryIdentity", () => ({
  resolveCountryIdentities: async () => new Map(),
}));
import { getDb } from "@/lib/mongodb";
import { GET } from "./route";

describe("character creation currency preview", () => {
  it("returns the same stored base used by starting endowments, excluding live market rates", async () => {
    const db = createInMemoryDb();
    db.seed("exchangeRates", [{ currencyCode: "NGN", baseRate: 0.357, rate: 1550 }]);
    vi.mocked(getDb).mockResolvedValue(db as unknown as Awaited<ReturnType<typeof getDb>>);
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.baseRates).toEqual({ NGN: 0.357 });
    expect(body.preset).toBe("1953-default");
  });
});
