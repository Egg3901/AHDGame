import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { ExtractionContract } from "@/lib/db/types/extractionContract";
import {
  computeContractedShare,
  computeRemainingContractHeadroom,
  contractedShareFilter,
} from "./computeContractedShare";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function cursorOf<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
  };
}

function contract(over: Partial<ExtractionContract>): ExtractionContract {
  return {
    _id: new ObjectId(),
    stateId: "TX",
    countryId: "US",
    corporationId: new ObjectId(),
    resource: "oil",
    share: 0.25,
    grantedTurn: 1,
    grantedBy: "us-congress",
    grantedByLevel: "national",
    updatedAt: new Date(),
    ...over,
  };
}

describe("contractedShareFilter", () => {
  it("includes offered contracts but excludes terminal ones (revokedTurn absent)", () => {
    expect(contractedShareFilter("TX", "oil")).toEqual({
      stateId: "TX",
      resource: "oil",
      revokedTurn: { $exists: false },
    });
  });
});

describe("computeContractedShare", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("sums share across active, offered, and legacy (status-less) contracts", async () => {
    db.collection("extractionContracts");
    db.collectionMocks["extractionContracts"]!.find.mockReturnValue(
      cursorOf([
        contract({ status: "active", share: 0.3 }),
        contract({ status: "offered", share: 0.2 }), // pending offers still reserve headroom
        contract({ share: 0.1 }), // legacy admin grant, no status
      ]) as never
    );

    expect(await computeContractedShare(db as unknown as Db, "TX", "oil")).toBeCloseTo(0.6);
    expect(await computeRemainingContractHeadroom(db as unknown as Db, "TX", "oil")).toBeCloseTo(
      0.15
    );
  });

  it("returns 0 when there are no contracts", async () => {
    expect(await computeContractedShare(db as unknown as Db, "TX", "oil")).toBe(0);
    expect(await computeRemainingContractHeadroom(db as unknown as Db, "TX", "oil")).toBeCloseTo(
      0.75
    );
  });
});
