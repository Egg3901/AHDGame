import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/db/partyLookup", () => ({
  findPartyBySequentialId: vi.fn(),
}));

vi.mock("@/lib/db/recruitmentSlateLookup", () => ({
  listPartySlates: vi.fn(),
  listSlateCandidatesByIds: vi.fn(),
}));

describe("GET /api/country/[code]/parties/[id]/slate", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("elections");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", username: "tester", isAdmin: false },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "JP",
      name: "Test Party",
    } as never);

    const { listPartySlates, listSlateCandidatesByIds } =
      await import("@/lib/db/recruitmentSlateLookup");
    vi.mocked(listPartySlates).mockResolvedValue([]);
    vi.mocked(listSlateCandidatesByIds).mockResolvedValue([]);
  });

  it("keeps both active JP sangiin classes visible after one class enters the general phase", async () => {
    const now = new Date();
    db.collectionMocks["elections"]!.find.mockReturnValue({
      project: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([
        {
          _id: { toString: () => "class-1" },
          countryId: "JP",
          electionType: "sangiin",
          state: "KAN",
          chamberClass: 1,
          status: "active",
          cycle: 1,
          primaryEndTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
        {
          _id: { toString: () => "class-2" },
          countryId: "JP",
          electionType: "sangiin",
          state: "KAN",
          chamberClass: 2,
          status: "active",
          cycle: 1,
          primaryEndTime: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
        {
          _id: { toString: () => "shugiin" },
          countryId: "JP",
          electionType: "shugiin",
          state: "KAN",
          status: "active",
          cycle: 1,
          primaryEndTime: new Date(now.getTime() + 12 * 60 * 60 * 1000),
        },
      ]),
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/country/jp/parties/1/slate"), {
      params: Promise.resolve({ code: "jp", id: "1" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { items: Array<{ electionId: string }> };
    expect(body.items.map((item) => item.electionId)).toEqual(["class-1", "class-2", "shugiin"]);
  });
});
