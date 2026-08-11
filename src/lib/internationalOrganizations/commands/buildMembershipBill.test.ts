import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";

vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(200) }));

const { buildMembershipBill } = await import("./buildMembershipBill");

beforeEach(() => vi.clearAllMocks());

function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const db = {
    collection: (name: string) => {
      if (name !== "bills") throw new Error(`unexpected collection ${name}`);
      return {
        insertOne: (doc: Record<string, unknown>) => {
          inserted.push(doc);
          return Promise.resolve({ insertedId: doc._id });
        },
      };
    },
  } as unknown as Db;
  return { db, inserted };
}

describe("buildMembershipBill", () => {
  it("inserts a foreign-policy bill carrying the int-org provision, no AP cost", async () => {
    const { db, inserted } = fakeDb();
    const proposalId = new ObjectId();
    const billId = await buildMembershipBill({
      db,
      countryId: "DE",
      sponsor: { characterId: new ObjectId(), characterName: "Klaus FM", party: "spd" },
      title: "Resolution to Join European Union",
      summary: "…",
      fullText: "…",
      provisions: [
        {
          type: "international_organization",
          subType: "join",
          organizationId: "EU",
          organizationName: "European Union",
          membershipProposalId: proposalId,
        },
      ],
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      _id: billId,
      countryId: "DE",
      category: "foreign policy",
      status: "active",
      proposalActionCost: 0,
      votingEndsOnTurn: 224, // 200 + 24
    });
    const provisions = inserted[0].provisions as Array<Record<string, unknown>>;
    expect(provisions[0]).toMatchObject({
      type: "international_organization",
      subType: "join",
      organizationId: "EU",
      membershipProposalId: proposalId,
    });
  });
});
