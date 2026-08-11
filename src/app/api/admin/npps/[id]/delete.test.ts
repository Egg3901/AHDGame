import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.resetModules();
  db = createMockDb();
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({ ok: true, admin: {} } as never);

  // Pre-initialize collections used by the route
  db.collection("npps");
  db.collection("electedOfficials");
  db.collection("electionCandidates");
});

describe("DELETE /api/admin/npps/[id]", () => {
  it("returns 404 when NPP not found", async () => {
    db.collectionMocks.npps.findOne.mockResolvedValue(null);

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://test"), {
      params: Promise.resolve({ id: new ObjectId().toString() }),
    });

    expect(res.status).toBe(404);
  });

  it("deletes NPP and cascades to office + candidacy collections", async () => {
    const nppId = new ObjectId();
    db.collectionMocks.npps.findOne.mockResolvedValue({ _id: nppId });
    db.collectionMocks.npps.deleteOne.mockResolvedValue({ deletedCount: 1 });
    db.collectionMocks.electedOfficials.deleteMany.mockResolvedValue({ deletedCount: 0 });
    db.collectionMocks.electionCandidates.deleteMany.mockResolvedValue({ deletedCount: 0 });

    const { DELETE } = await import("./route");
    const res = await DELETE(new Request("http://test"), {
      params: Promise.resolve({ id: nppId.toString() }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(db.collectionMocks.npps.deleteOne).toHaveBeenCalledWith({
      _id: nppId,
    });
    expect(db.collectionMocks.electedOfficials.deleteMany).toHaveBeenCalledWith({ nppId });
    expect(db.collectionMocks.electionCandidates.deleteMany).toHaveBeenCalledWith({ nppId });
  });
});
