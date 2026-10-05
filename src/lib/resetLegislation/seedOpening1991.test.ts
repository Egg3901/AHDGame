import { describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { buildOpeningLawBoards1991 } from "./openingBoards1991";
import { buildOpeningRegionalBoards1991 } from "@/lib/resetFinance/openingRegionalBoards1991";
import { seedOpeningLawBoards1991 } from "./seedOpening1991";

function mockRegionRoster(db: ReturnType<typeof createMockDb>) {
  const boards = buildOpeningLawBoards1991("world-test", 1);
  db.collection("states").find.mockReturnValue({
    toArray: vi
      .fn()
      .mockResolvedValue(
        boards
          .filter((board) => board.scope === "regional")
          .map((board) => ({ _id: board.regionId, countryId: board.countryId }))
      ),
  });
  db.collection("stateBudgets").find.mockReturnValue({
    toArray: vi.fn().mockResolvedValue(
      boards
        .filter((board) => board.ukTerritorialTax)
        .map((board) => ({
          stateId: board.regionId,
          countryId: board.countryId,
          revenue: {
            propertyTax: board.ukTerritorialTax!.sourceOwnRevenueProxy,
            domesticCorporateTax: 0,
            foreignCorporateTax: 0,
          },
        }))
    ),
  });
  return boards;
}

describe("1991 v2 current-law seed", () => {
  it("writes and verifies 74 full boards without changing v1 policies or laws", async () => {
    const db = createMockDb();
    const boards = mockRegionRoster(db);
    db.collection("resetLawOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(boards),
    });
    db.collection("resetRegionalOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(buildOpeningRegionalBoards1991("world-test", 1)),
    });
    const receipt = await seedOpeningLawBoards1991(db as unknown as Db, "world-test", 1);
    expect(receipt).toMatchObject({
      worldId: "world-test",
      revision: 6,
      sourceTurn: 1,
      verificationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.collectionMocks.resetLawOpeningBoards!.bulkWrite.mock.calls[0]![0]).toHaveLength(74);
    expect(db.collectionMocks.resetRegionalOpeningBoards!.bulkWrite.mock.calls[0]![0]).toHaveLength(
      71
    );
    expect(db.collectionMocks.policies).toBeUndefined();
    expect(db.collectionMocks.enactedLaws).toBeUndefined();
  });

  it("rejects a missing region or altered persisted current-law component", async () => {
    const db = createMockDb();
    db.collection("states").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    await expect(seedOpeningLawBoards1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "regions do not match"
    );
    expect(db.collectionMocks.resetLawOpeningBoards).toBeUndefined();

    const boards = mockRegionRoster(db);
    const changed = structuredClone(boards);
    changed[0]!.references.L19!.currentLaw = "Wrong law";
    db.collection("resetLawOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(changed),
    });
    await expect(seedOpeningLawBoards1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "failed readback verification"
    );
  });

  it("does not certify legislation when the regional fiscal board is incomplete", async () => {
    const db = createMockDb();
    const boards = mockRegionRoster(db);
    db.collection("resetLawOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(boards),
    });
    db.collection("resetRegionalOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
    });
    await expect(seedOpeningLawBoards1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "regional fiscal opening failed readback"
    );
  });

  it("rejects a changed UK 1991 local-tax fixture on readback", async () => {
    const db = createMockDb();
    const boards = mockRegionRoster(db);
    const changed = structuredClone(boards);
    const london = changed.find((board) => board._id === "UK:LON")!;
    london.ukTerritorialTax!.domestic = "domestic_rates";
    db.collection("resetLawOpeningBoards").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(changed),
    });
    await expect(seedOpeningLawBoards1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "failed readback verification"
    );
  });

  it("rejects a UK tax proxy that differs from the actual seeded regional budget", async () => {
    const db = createMockDb();
    const boards = mockRegionRoster(db);
    db.collection("stateBudgets").find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(
        boards
          .filter((board) => board.ukTerritorialTax)
          .map((board) => ({
            stateId: board.regionId,
            countryId: board.countryId,
            revenue: {
              propertyTax:
                board.ukTerritorialTax!.sourceOwnRevenueProxy + (board.regionId === "LON" ? 1 : 0),
              domesticCorporateTax: 0,
              foreignCorporateTax: 0,
            },
          }))
      ),
    });
    await expect(seedOpeningLawBoards1991(db as unknown as Db, "world-test", 1)).rejects.toThrow(
      "regional tax proxy differs"
    );
  });
});
