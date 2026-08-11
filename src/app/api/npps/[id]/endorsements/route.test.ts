import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

describe("GET /api/npps/[id]/endorsements", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("npps");
    db.collection("nppEndorsements");
    db.collection("elections");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("rejects malformed NPP ids", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/bad/endorsements"), {
      params: Promise.resolve({ id: "bad-id" }),
    });

    expect(response.status).toBe(400);
  });

  it("returns active endorsements with election context", async () => {
    const nppId = new ObjectId();
    const electionId = new ObjectId();
    db.collectionMocks.npps.findOne.mockResolvedValue({
      _id: nppId,
      name: "Pat Doe",
    } as never);
    db.collectionMocks.nppEndorsements.find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            _id: new ObjectId(),
            nppId,
            electionId,
            candidateId: new ObjectId(),
            candidateName: "Player Candidate",
            candidateIsNPP: false,
            source: "arranged",
            arrangedBy: new ObjectId(),
            createdAt: new Date("2026-05-01T00:00:00Z"),
          },
        ]),
      }),
    } as never);
    db.collectionMocks.elections.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          _id: electionId,
          state: "US_CA",
          electionType: "senate",
          senateClass: 2,
          status: "active",
        },
      ]),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/npps/endorsements"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.npp).toMatchObject({ id: nppId.toString(), name: "Pat Doe" });
    expect(body.total).toBe(1);
    expect(body.endorsements[0]).toMatchObject({
      candidateName: "Player Candidate",
      election: {
        id: electionId.toString(),
        label: "US_CA senate (Class 2)",
      },
    });
  });
});
