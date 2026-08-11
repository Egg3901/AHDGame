import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("empty-org accession waiver", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("admitMember stamps founding status when asked", async () => {
    const { admitMember } = await import("./joinApplication");
    await admitMember(db as unknown as Db, "EU", "DE", 700, { status: "founding" });
    expect(db.collectionMocks.organizationMemberships!.updateOne).toHaveBeenCalledWith(
      { organizationId: "EU", countryId: "DE" },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ status: "founding", joinedTurn: 700 }),
      }),
      { upsert: true }
    );
  });

  it("admitMember defaults to active status", async () => {
    const { admitMember } = await import("./joinApplication");
    await admitMember(db as unknown as Db, "EU", "DE", 700);
    expect(db.collectionMocks.organizationMemberships!.updateOne).toHaveBeenCalledWith(
      { organizationId: "EU", countryId: "DE" },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ status: "active" }),
      }),
      { upsert: true }
    );
  });

  it("resolveJoinApplication admits an exempt proposal as a founding member once the bill passes", async () => {
    const proposalId = new ObjectId();
    const billId = new ObjectId();
    db.collection("organizationMembershipProposals").findOne.mockResolvedValue({
      _id: proposalId,
      organizationId: "EU",
      proposingCountryId: "DE",
      status: "pending",
      orgVoteExempt: true,
      orgApproved: true,
      domesticBillId: billId,
    });
    db.collection("bills").findOne.mockResolvedValue({ _id: billId, status: "signed" });

    const { resolveJoinApplication } = await import("./joinApplication");
    await resolveJoinApplication(db as unknown as Db, proposalId, 720);

    expect(db.collectionMocks.organizationMemberships!.updateOne).toHaveBeenCalledWith(
      { organizationId: "EU", countryId: "DE" },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({ status: "founding" }),
      }),
      { upsert: true }
    );
    expect(db.collectionMocks.organizationMembershipProposals!.updateOne).toHaveBeenCalledWith(
      { _id: proposalId },
      expect.objectContaining({ $set: expect.objectContaining({ status: "approved" }) })
    );
  });
});
