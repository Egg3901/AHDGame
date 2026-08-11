import { describe, expect, it, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("./nationalCorporation", () => ({
  resolveNationalCorporationForSector: vi.fn(),
}));

import { resolveNationalCorporationForSector } from "./nationalCorporation";
import {
  absorbOwnedSectorIntoNatCorp,
  absorbUnownedDocIntoNatCorp,
  incrementNatCorpSectorRevenue,
} from "./seedToNatCorp";

const NAT_ID = new ObjectId();

describe("incrementNatCorpSectorRevenue", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: NAT_ID } as never);
    db = createMockDb();
    db.collection("corporateSectors");
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue(null);
    db.collectionMocks.corporateSectors.insertOne.mockResolvedValue({ insertedId: new ObjectId() });
  });

  it("inserts a new nat corp sector when none exists", async () => {
    const result = await incrementNatCorpSectorRevenue(db as unknown as Db, {
      countryId: "CN",
      stateId: "BJ",
      sectorType: "energy",
      revenueDelta: 5_000_000,
    });
    expect(result).toBe("insert");
    expect(db.collectionMocks.corporateSectors.insertOne).toHaveBeenCalled();
  });

  it("increments an existing nat corp sector", async () => {
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: new ObjectId(),
      revenue: 1_000_000,
    });
    const result = await incrementNatCorpSectorRevenue(db as unknown as Db, {
      countryId: "CN",
      stateId: "BJ",
      sectorType: "energy",
      revenueDelta: 500_000,
    });
    expect(result).toBe("inc");
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalled();
  });
});

describe("absorbUnownedDocIntoNatCorp", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: NAT_ID } as never);
    db = createMockDb();
    db.collection("corporateSectors");
    db.collection("unownedSectors");
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: new ObjectId(),
      revenue: 2_000_000,
    });
  });

  it("moves revenue to nat corp and deletes the unowned doc", async () => {
    const docId = new ObjectId();
    const transferred = await absorbUnownedDocIntoNatCorp(db as unknown as Db, {
      _id: docId,
      stateId: "BJ",
      sectorType: "energy",
      countryId: "CN",
      revenue: 3_000_000,
    });
    expect(transferred).toBe(3_000_000);
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.unownedSectors.deleteOne).toHaveBeenCalledWith({ _id: docId });
  });
});

describe("absorbOwnedSectorIntoNatCorp", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveNationalCorporationForSector).mockResolvedValue({ _id: NAT_ID } as never);
    db = createMockDb();
    db.collection("corporateSectors");
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: new ObjectId(),
      revenue: 2_000_000,
    });
  });

  it("merges a private sector into the nat corp holding and deletes the donor row", async () => {
    const donorId = new ObjectId();
    const natRowId = new ObjectId();
    db.collectionMocks.corporateSectors.findOne.mockResolvedValue({
      _id: natRowId,
      revenue: 2_000_000,
    });
    const transferred = await absorbOwnedSectorIntoNatCorp(db as unknown as Db, {
      _id: donorId,
      stateId: "BJ",
      sectorType: "energy",
      countryId: "CN",
      revenue: 750_000,
      workers: 10,
      currentGrowthCost: 5_000,
      corporationId: new ObjectId(),
    });
    expect(transferred).toBe(750_000);
    expect(db.collectionMocks.corporateSectors.updateOne).toHaveBeenCalled();
    expect(db.collectionMocks.corporateSectors.deleteOne).toHaveBeenCalledWith({ _id: donorId });
  });
});
