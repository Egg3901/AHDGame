import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/us/parties/1/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ code: "us", id: "1" });

describe("PATCH /api/country/[code]/parties/[id]/settings leadership titles", () => {
  let db: MockDb;
  let chairId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();
    db.collection("politicalParties");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: chairId, name: "Chair" },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      chairId,
      viceChairId: new ObjectId(),
      leadershipTitles: { chair: "Chairperson" },
    } as never);
  });

  it("trims and persists the title overrides", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      makeRequest({
        leadershipTitles: {
          chair: "  General Secretary  ",
          viceChair: "  Deputy Secretary ",
          treasurer: "   ",
        },
      }),
      { params }
    );

    expect(response.status).toBe(200);
    const update = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0]?.[1] as {
      $set: { leadershipTitles: Record<string, string | null> };
    };
    expect(update.$set.leadershipTitles).toEqual({
      chair: "General Secretary",
      viceChair: "Deputy Secretary",
      treasurer: null,
    });
  });

  it("rejects titles longer than the server limit", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(
      makeRequest({
        leadershipTitles: {
          chair: "x".repeat(41),
          viceChair: null,
          treasurer: null,
        },
      }),
      { params }
    );

    expect(response.status).toBe(400);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("checks the length after trimming outer whitespace", async () => {
    const { PATCH } = await import("./route");
    const titleAtLimit = "x".repeat(40);
    const response = await PATCH(
      makeRequest({
        leadershipTitles: {
          chair: `  ${titleAtLimit}  `,
          viceChair: null,
          treasurer: null,
        },
      }),
      { params }
    );

    expect(response.status).toBe(200);
    const update = db.collectionMocks["politicalParties"]!.updateOne.mock.calls[0]?.[1] as {
      $set: { leadershipTitles: Record<string, string | null> };
    };
    expect(update.$set.leadershipTitles.chair).toBe(titleAtLimit);
  });

  it("rejects title changes by a non-chair", async () => {
    const viceChairId = new ObjectId();
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: viceChairId, name: "Vice Chair" },
      },
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(
      makeRequest({
        leadershipTitles: { chair: "General Secretary", viceChair: null, treasurer: null },
      }),
      { params }
    );

    expect(response.status).toBe(403);
    expect(db.collectionMocks["politicalParties"]!.updateOne).not.toHaveBeenCalled();
  });

  it("allows the vice chair to manage titles while the chair seat is vacant", async () => {
    const actingViceChairId = new ObjectId();
    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: actingViceChairId, name: "Vice Chair" },
      },
    } as never);
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 1,
      countryId: "US",
      chairId: null,
      viceChairId: actingViceChairId,
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(
      makeRequest({
        leadershipTitles: { chair: "Chair", viceChair: "Acting Chair", treasurer: "Treasurer" },
      }),
      { params }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["politicalParties"]!.updateOne).toHaveBeenCalledOnce();
  });
});
