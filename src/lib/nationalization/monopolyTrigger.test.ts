import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/corporations/marketShare", () => ({
  fetchSectorMarketSharePercent: vi.fn(),
}));

describe("getTopMarketSharePercent", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
  });

  it("returns the max share across the corp's sectors", async () => {
    const { fetchSectorMarketSharePercent } = await import("@/lib/corporations/marketShare");
    vi.mocked(fetchSectorMarketSharePercent).mockResolvedValueOnce(40).mockResolvedValueOnce(82);

    const corp = { _id: new ObjectId(), countryId: "US", liquidCurrencyCode: "USD" };
    const sectors = [
      { _id: new ObjectId(), stateId: "CA", sectorType: "energy", revenue: 1, countryId: "US" },
      { _id: new ObjectId(), stateId: "TX", sectorType: "energy", revenue: 1, countryId: "US" },
    ];

    const { getTopMarketSharePercent } = await import("./monopolyTrigger");
    const top = await getTopMarketSharePercent(
      db as unknown as Db,
      corp as never,
      sectors as never
    );
    expect(top).toBe(82);
  });

  it("returns 0 for a corp with no sectors", async () => {
    const { getTopMarketSharePercent } = await import("./monopolyTrigger");
    const corp = { _id: new ObjectId(), countryId: "US" };
    expect(await getTopMarketSharePercent(db as unknown as Db, corp as never, [])).toBe(0);
  });
});
