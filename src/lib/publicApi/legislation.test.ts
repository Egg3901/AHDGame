import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

describe("queryLegislation", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("bills");
  });

  it("returns empty list when no bills match", async () => {
    db.collectionMocks.bills!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    } as never);

    const { queryLegislation } = await import("./legislation");
    const result = await queryLegislation(db as unknown as Db, { country: "US", status: "passed" });
    expect(result).toEqual({ found: false, bills: [] });
  });

  it("maps provisions to simplified effects array", async () => {
    const billId = new ObjectId();
    db.collectionMocks.bills!.find.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: billId,
          title: "Healthcare Reform Act",
          sponsorName: "Jane Smith",
          sponsorParty: "Democrats",
          countryId: "US",
          status: "enacted",
          proposedAt: new Date("2025-01-01"),
          enactedAt: new Date("2025-01-10"),
          votesFor: 260,
          votesAgainst: 175,
          votesAbstain: 0,
          provisions: [
            { legislationTypeId: "healthcareSpending", effectDirection: 1 },
            { type: "tariff", scopeType: "economy_wide", rate: 5 },
          ],
        },
      ]),
    } as never);

    const { queryLegislation } = await import("./legislation");
    const result = await queryLegislation(db as unknown as Db, { country: "US", status: "passed" });

    expect(result.found).toBe(true);
    expect(result.bills[0].effects).toContainEqual({
      metric: "healthcareSpending",
      direction: "increase",
    });
    expect(result.bills[0].effects).toContainEqual({ metric: "tariff", direction: "change" });
  });

  it("respects limit parameter", async () => {
    const cursor = {
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    };
    db.collectionMocks.bills!.find.mockReturnValue(cursor as never);

    const { queryLegislation } = await import("./legislation");
    await queryLegislation(db as unknown as Db, { country: "US", limit: 10 });

    expect(cursor.limit).toHaveBeenCalledWith(10);
  });
});
