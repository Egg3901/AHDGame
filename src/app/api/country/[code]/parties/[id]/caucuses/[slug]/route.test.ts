import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/caucusLookup", () => ({
  findCaucusBySlug: vi.fn(),
  listCaucusPositions: vi.fn(),
  countCaucusMembers: vi.fn(),
  normaliseCaucusSlug: vi.fn(),
  reclaimSlug: vi.fn(),
}));

describe("DELETE /api/country/[code]/parties/[id]/caucuses/[slug]", () => {
  let db: MockDb;
  let caucusId: ObjectId;
  let chairId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    caucusId = new ObjectId();
    chairId = new ObjectId();

    db.collection("caucuses");
    db.collection("caucusMemberships");
    db.collection("characters");
    db.collection("npps");

    db.collectionMocks["caucusMemberships"]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([]),
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      project: vi.fn().mockReturnThis(),
    });

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { character: { _id: chairId } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 7,
      countryId: "US",
    } as never);

    const { findCaucusBySlug } = await import("@/lib/db/caucusLookup");
    vi.mocked(findCaucusBySlug).mockResolvedValue({
      caucus: {
        _id: caucusId,
        chairId,
        slug: "main-street",
      },
      isRedirect: false,
    } as never);
  });

  it("soft-disbands the caucus when the chair deletes it", async () => {
    const { DELETE } = await import("./route");

    const response = await DELETE(
      new Request("http://localhost/api/country/us/parties/7/caucuses/main-street"),
      {
        params: Promise.resolve({ code: "us", id: "7", slug: "main-street" }),
      }
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks["caucuses"]!.updateOne).toHaveBeenCalledWith(
      { _id: caucusId },
      { $set: { disbandedAt: expect.any(Date), updatedAt: expect.any(Date) } }
    );
  });
});
