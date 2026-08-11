import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/legislature/billAutoFailWarning", () => ({
  getBillProposalAutoFailWarning: vi.fn().mockResolvedValue(null),
  getBillProposalAutoFailWarningError: vi.fn(),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();
  db.collection("bills");
  db.collection("governmentFormations");
  db.collection("politicalParties");
  db.collection("legislationTypes");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { getAuthUser } = await import("@/lib/auth");
  vi.mocked(getAuthUser).mockResolvedValue(null);
});

describe("GET /api/country/[code]/legislature/cabinet-bills", () => {
  it("returns cabinet bills in BillDisplay shape with a string id", async () => {
    const billId = new ObjectId();
    const now = new Date("2026-04-26T13:45:10.235Z");

    db.collectionMocks["governmentFormations"]!.findOne.mockResolvedValue({ _id: "JP" });
    db.collectionMocks["politicalParties"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([
          { _id: "party-1", sequentialId: 1, countryId: "JP", name: "CDP", color: "#2255aa" },
        ]),
    });
    db.collectionMocks["legislationTypes"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: "vocational_training",
          name: "Vocational Training",
          policyOptions: [],
        },
      ]),
    });
    db.collectionMocks["bills"]!.find.mockImplementation((filter: { projection?: unknown }) => {
      if ("status" in filter) {
        return {
          toArray: vi.fn().mockResolvedValue([]),
          sort: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
        };
      }

      return {
        toArray: vi.fn().mockResolvedValue([
          {
            _id: billId,
            countryId: "JP",
            title: "Regional Skills and Vocational Training Act.",
            summary: "Invest in regional training centers.",
            originChamber: "cabinet",
            currentChamber: "shugiin",
            sponsorId: new ObjectId(),
            sponsorName: "Marcus",
            sponsorParty: "1",
            status: "cabinet_review",
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            votes: {},
            category: "education",
            legislationTypeId: "vocational_training",
            effectDirection: 1,
            provisions: [{ legislationTypeId: "vocational_training", effectDirection: 1 }],
            proposedAt: now,
            votingStartedAt: now,
            votingEndsAt: new Date(now.getTime() + 86_400_000),
            createdAt: now,
            updatedAt: now,
          },
        ]),
        sort: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      };
    });

    const { GET } = await import("./route");
    const res = await GET(
      new Request("http://localhost/api/country/jp/legislature/cabinet-bills"),
      {
        params: Promise.resolve({ code: "jp" }),
      }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.bills).toHaveLength(1);
    expect(json.bills[0]).toEqual(
      expect.objectContaining({
        id: billId.toString(),
        originChamber: "cabinet",
        status: "cabinet_review",
        canVoteOrigin: false,
      })
    );
  });
});
