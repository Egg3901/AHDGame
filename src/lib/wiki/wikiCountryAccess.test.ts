import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("next/cache", () => ({
  unstable_cache: (load: () => Promise<unknown>) => {
    let cached: Promise<unknown> | undefined;
    return () => (cached ??= load());
  },
}));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("wiki country access snapshot", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    db.collection("countryGameStates").find.mockReturnValue({ toArray: async () => [] } as never);
    db.collection("gameState").findOne.mockResolvedValue(null);
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("shares one countryGameStates read across wiki index panels", async () => {
    const { getAllCountryAccess } = await import("@/lib/countryAccess");
    const { getWikiCountryAccess } = await import("./getWikiPageData");

    await Promise.all([getAllCountryAccess(), getAllCountryAccess(), getAllCountryAccess()]);
    expect(db.collectionMocks.countryGameStates.find).toHaveBeenCalledTimes(3);
    db.collectionMocks.countryGameStates.find.mockClear();

    await Promise.all([getWikiCountryAccess(), getWikiCountryAccess(), getWikiCountryAccess()]);

    expect(db.collectionMocks.countryGameStates.find).toHaveBeenCalledTimes(1);
  });
});
