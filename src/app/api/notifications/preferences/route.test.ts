import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
const userId = new ObjectId();
let db: MockDb;
beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("users");
  vi.mocked((await import("@/lib/mongodb")).getDb).mockResolvedValue(db as unknown as Db);
  vi.mocked((await import("@/lib/api/requireAuth")).requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
  db.collectionMocks.users!.findOne.mockResolvedValue({
    _id: userId,
    notificationPreferences: { mutedTypes: ["crisis"], muteMail: true },
  });
});
async function put(body: object) {
  const { PUT } = await import("./route");
  return PUT(
    new Request("http://localhost/api/notifications/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}
describe("notification preferences", () => {
  it("loads saved mail and alert preferences", async () => {
    const { GET } = await import("./route");
    expect(
      await (await GET(new Request("http://localhost/api/notifications/preferences"))).json()
    ).toMatchObject({ muteMail: true, mutedTypes: ["crisis"] });
  });
  it("changes message alerts without replacing other preferences", async () => {
    const response = await put({ action: "mail", muted: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ muteMail: false, mutedTypes: ["crisis"] });
    expect(db.collectionMocks.users!.updateOne).toHaveBeenCalledWith(
      { _id: userId },
      { $set: { "notificationPreferences.muteMail": false } }
    );
  });
  it("keeps the saved mail setting when changing an alert type", async () => {
    const response = await put({ action: "mute", type: "party_whip_issued" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      muteMail: true,
      mutedTypes: ["crisis", "party_whip_issued"],
    });
    expect(db.collectionMocks.users!.updateOne.mock.calls[0][1].$set).not.toHaveProperty(
      "notificationPreferences"
    );
  });
  it("rejects non-boolean message preferences", async () => {
    expect((await put({ action: "mail", muted: "false" })).status).toBe(400);
    expect(db.collectionMocks.users!.updateOne).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    vi.mocked((await import("@/lib/api/requireAuth")).requireBasicAuth).mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    } as never);
    expect((await put({ action: "mail", muted: true })).status).toBe(401);
    expect(db.collectionMocks.users!.updateOne).not.toHaveBeenCalled();
  });
});
