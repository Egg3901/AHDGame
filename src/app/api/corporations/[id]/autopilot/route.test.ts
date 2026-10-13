import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api/corporations/resolveQuery")>()),
  resolveCorporation: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(80) }));

let db: MockDb;
const ownerId = new ObjectId();
const corpId = new ObjectId();

async function setCorp(overrides: Record<string, unknown> = {}) {
  const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
  vi.mocked(resolveCorporation).mockResolvedValue({
    ok: true,
    corporation: {
      _id: corpId,
      userId: ownerId,
      ceoId: new ObjectId(),
      ceoType: "character",
      ceoVacant: false,
      ...overrides,
    },
  } as never);
}

async function signIn(userId: ObjectId) {
  const { requireBasicAuth } = await import("@/lib/api/requireAuth");
  vi.mocked(requireBasicAuth).mockResolvedValue({
    ok: true,
    user: { userId: userId.toString() },
  } as never);
}

const ctx = { params: Promise.resolve({ id: corpId.toString() }) };
const req = (method: string) =>
  new Request("http://localhost/api/corporations/x/autopilot", { method });
const updateOne = () => db.collectionMocks["corporations"]!.updateOne;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("corporations");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as never);
  updateOne().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  await signIn(ownerId);
  await setCorp();
});

describe("POST/DELETE /api/corporations/[id]/autopilot", () => {
  it("turns autopilot on with the sitting CEO re-asserted in the write", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(200);
    const [filter, update] = updateOne().mock.calls[0];
    expect(filter).toMatchObject({
      _id: corpId,
      userId: ownerId,
      ceoVacant: { $ne: true },
      autopilot: { $exists: false },
      ceoType: { $ne: "npp" },
    });
    expect(update.$set.autopilot).toEqual({ enabledTurn: 80 });
  });

  it("turns autopilot off", async () => {
    await setCorp({ autopilot: { enabledTurn: 10 } });
    const { DELETE } = await import("./route");
    const res = await DELETE(req("DELETE"), ctx);
    expect(res.status).toBe(200);
    const [filter, update] = updateOne().mock.calls[0];
    expect(filter).toMatchObject({ userId: ownerId, autopilot: { $exists: true } });
    expect(update.$unset).toEqual({ autopilot: "" });
  });

  it("refuses anyone but the CEO", async () => {
    await signIn(new ObjectId());
    const { POST } = await import("./route");
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(403);
    expect(updateOne()).not.toHaveBeenCalled();
  });

  it("refuses a caretaker-run corporation", async () => {
    await setCorp({ ceoType: "npp" });
    const { POST } = await import("./route");
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(400);
    expect(updateOne()).not.toHaveBeenCalled();
  });

  it("reports a conflict when the seat changed between read and write", async () => {
    updateOne().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const { POST } = await import("./route");
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(409);
  });
});
