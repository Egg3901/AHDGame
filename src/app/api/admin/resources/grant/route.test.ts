import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/currency/featureFlag", () => ({ isForexEnabled: vi.fn() }));
vi.mock("@/lib/financialTxLog/emit", () => ({
  emitTxBulk: vi.fn(),
  loadTxThresholds: vi.fn(),
}));

describe("POST /api/admin/resources/grant", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: new ObjectId().toString(), username: "Admin" },
    } as never);
    const { isForexEnabled } = await import("@/lib/currency/featureFlag");
    vi.mocked(isForexEnabled).mockResolvedValue(false);
  });

  it("grants one voucher to every selected character and audits it", async () => {
    const characterId = new ObjectId();
    db.collection("characters");
    db.collection("adminLogs");
    db.collectionMocks.characters!.updateMany.mockResolvedValue({ modifiedCount: 1 });

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/admin/resources/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterIds: [characterId.toString()],
          positionUpdateVoucher: true,
        }),
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.message).toMatch(/positions update voucher/i);
    expect(db.collectionMocks.characters!.updateMany).toHaveBeenCalledWith(
      { _id: { $in: [characterId] } },
      [
        {
          $set: expect.objectContaining({
            positionUpdateVouchers: {
              $add: [{ $ifNull: ["$positionUpdateVouchers", 0] }, 1],
            },
          }),
        },
      ]
    );
    expect(db.collectionMocks.adminLogs!.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.stringMatching(/positions update voucher/i) })
    );
  });
});
