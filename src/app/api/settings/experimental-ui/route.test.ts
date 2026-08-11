import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));

describe("PATCH /api/settings/experimental-ui", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("users");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("updates enableExperimentalUI on the authenticated user", async () => {
    const userId = new ObjectId();

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: userId.toString() },
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://localhost/api/settings/experimental-ui", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableExperimentalUI: true }),
      })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.users.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      expect.objectContaining({
        $set: expect.objectContaining({ enableExperimentalUI: true }),
      })
    );
  });

  it("rejects invalid body", async () => {
    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString() },
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(
      new Request("http://localhost/api/settings/experimental-ui", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enableExperimentalUI: "yes" }),
      })
    );

    expect(response.status).toBe(400);
  });
});
