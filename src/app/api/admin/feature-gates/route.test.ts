import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));

function request(body: unknown) {
  return new Request("http://localhost/api/admin/feature-gates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin feature gates foreign policy mode", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    const { requireAdmin } = await import("@/lib/api/requireAdmin");
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { username: "tester" },
    } as never);
  });

  it("reports the active votes rollout when the fields are absent", async () => {
    db.collection("gameState").findOne.mockResolvedValue({ _id: "current" });
    const { GET } = await import("./route");

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "votes",
    });
  });

  it("activates the planner with an admin audit stamp", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
    });
    const { POST } = await import("./route");

    const response = await POST(request({ kind: "foreign-policy-mode", value: "active" }));

    expect(response.status).toBe(200);
    const [, update] = db.collection("gameState").updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      nppForeignPolicyMode: "active",
      nppForeignPolicyModeBy: "tester",
    });
    expect(update.$set.nppForeignPolicyModeAt).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({ nppForeignPolicyMode: "active" });
  });

  it("rejects unknown rollout values", async () => {
    const { POST } = await import("./route");

    const response = await POST(request({ kind: "foreign-policy-mode", value: "unbounded" }));

    expect(response.status).toBe(400);
    expect(db.collection("gameState").updateOne).not.toHaveBeenCalled();
  });

  it("advances the active rollout stage with an admin audit stamp", async () => {
    db.collection("gameState").findOne.mockResolvedValue({
      _id: "current",
      nppForeignPolicyMode: "active",
      nppForeignPolicyStage: "trade",
    });
    const { POST } = await import("./route");

    const response = await POST(request({ kind: "foreign-policy-stage", value: "trade" }));

    expect(response.status).toBe(200);
    const [, update] = db.collection("gameState").updateOne.mock.calls[0];
    expect(update.$set).toMatchObject({
      nppForeignPolicyStage: "trade",
      nppForeignPolicyStageBy: "tester",
    });
    expect(update.$set.nppForeignPolicyStageAt).toBeTruthy();
  });
});
