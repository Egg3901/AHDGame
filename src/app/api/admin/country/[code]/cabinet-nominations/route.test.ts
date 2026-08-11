import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({
  getGameTime: vi.fn().mockResolvedValue({ currentTurn: 100, effectiveNow: new Date(0) }),
}));

let db: MockDb;

beforeEach(async () => {
  db = createMockDb();
  vi.clearAllMocks();

  db.collection("cabinetNominations");
  db.collection("cabinetMembers");
  db.collection("cabinetSettings");
  db.collection("characters");

  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, user: { userId: "admin" } } as never);
});

describe("POST /api/admin/country/[code]/cabinet-nominations — force_confirm", () => {
  it("resets the position's setting cooldowns when an admin force-confirms a nominee", async () => {
    const nominationId = new ObjectId();
    db.collectionMocks.cabinetNominations.findOne.mockResolvedValue({
      _id: nominationId,
      countryId: "US",
      positionId: "secretary_of_treasury",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "Admin Pick",
      nomineeParty: "democrat",
      status: "active",
    });

    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://localhost/api/admin/country/us/cabinet-nominations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nominationId: nominationId.toString(), action: "force_confirm" }),
      }),
      { params: Promise.resolve({ code: "us" }) }
    );

    expect(res.status).toBe(200);
    expect(db.collectionMocks.cabinetSettings.updateOne).toHaveBeenCalledWith(
      { _id: "US_secretary_of_treasury" },
      { $unset: { lastChangedTurn: "", lastAllocationChangedTurn: "" } }
    );
  });
});
