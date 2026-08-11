import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/currency/corporationCapital", async (orig) => {
  const actual = await orig<typeof import("@/lib/currency/corporationCapital")>();
  return { ...actual, loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map()) };
});
vi.mock("@/lib/nationalization/concentration", () => ({
  computeCountryStateOwnershipConcentration: vi.fn(),
  writeStateOwnershipConcentration: vi.fn().mockResolvedValue(undefined),
}));

function cursor<T>(rows: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(rows),
    project: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
  };
}

describe("processStateOwnershipConcentration", () => {
  let db: MockDb;
  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("federalBudget");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("recomputes and persists SOCI for every country", async () => {
    db.collectionMocks.federalBudget.find.mockReturnValue(
      cursor([{ countryId: "CN" }, { countryId: "US" }])
    );
    const { computeCountryStateOwnershipConcentration, writeStateOwnershipConcentration } =
      await import("@/lib/nationalization/concentration");
    vi.mocked(computeCountryStateOwnershipConcentration)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(0);

    const { processStateOwnershipConcentration } = await import("./stateOwnershipConcentration");
    const result = await processStateOwnershipConcentration(601);

    expect(result.countriesUpdated).toBe(2);
    expect(vi.mocked(writeStateOwnershipConcentration)).toHaveBeenCalledWith(
      expect.anything(),
      "CN",
      40,
      601
    );
    expect(vi.mocked(writeStateOwnershipConcentration)).toHaveBeenCalledWith(
      expect.anything(),
      "US",
      0,
      601
    );
  });
});
