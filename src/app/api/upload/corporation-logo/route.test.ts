import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireBasicAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/api/corporations/resolveQuery", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/corporations/resolveQuery")>(
    "@/lib/api/corporations/resolveQuery"
  );
  // requireCeo is a pure predicate — keep the real one so the authorization
  // contract is exercised rather than restated here.
  return { ...actual, resolveCorporation: vi.fn() };
});
vi.mock("@/lib/imageOptimize", () => ({
  IMAGE_PRESETS: { corporationLogo: {} },
  optimizeImage: vi.fn(async () => ({ buffer: Buffer.from("optimized"), ext: "png" })),
}));
vi.mock("@/lib/r2", () => ({
  isR2Enabled: vi.fn(() => true),
  deleteByPrefix: vi.fn(async () => undefined),
  uploadFile: vi.fn(async (pathname: string) => `https://cdn.example/${pathname}`),
}));

/** A logo upload request, optionally aimed at a specific corporation. */
function logoRequest(corporationId?: string): Request {
  const formData = new FormData();
  formData.append("file", new Blob(["raw"], { type: "image/png" }), "logo.png");
  if (corporationId) formData.append("corporationId", corporationId);
  return new Request("http://localhost/api/upload/corporation-logo", {
    method: "POST",
    body: formData,
  });
}

describe("POST /api/upload/corporation-logo", () => {
  let db: MockDb;
  let userId: string;
  let originalR2Key: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporations");

    originalR2Key = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-key";

    userId = new ObjectId().toString();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireBasicAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireBasicAuth).mockResolvedValue({ ok: true, user: { userId } } as never);
  });

  afterEach(() => {
    if (originalR2Key === undefined) {
      delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    } else {
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = originalR2Key;
    }
  });

  it("writes to the targeted corporation, not whichever one the user query returns first", async () => {
    // The user holds two corporation records — a stale earlier one and the
    // current one. An unscoped findOne can return either.
    const staleCorpId = new ObjectId();
    const currentCorpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: staleCorpId,
      userId: new ObjectId(userId),
    });

    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: currentCorpId, userId: new ObjectId(userId) },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(logoRequest(currentCorpId.toString()));

    expect(response.status).toBe(200);

    const { uploadFile } = await import("@/lib/r2");
    expect(vi.mocked(uploadFile)).toHaveBeenCalledWith(
      expect.stringContaining(currentCorpId.toString()),
      expect.any(Buffer)
    );
    expect(vi.mocked(uploadFile)).not.toHaveBeenCalledWith(
      expect.stringContaining(staleCorpId.toString()),
      expect.any(Buffer)
    );
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      { _id: currentCorpId },
      expect.objectContaining({ $set: expect.objectContaining({ logoUrl: expect.any(String) }) })
    );
  });

  it("refuses a corporation the requester does not run", async () => {
    const otherCorpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: otherCorpId, userId: new ObjectId() },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(logoRequest(otherCorpId.toString()));

    expect(response.status).toBe(403);
    const { uploadFile } = await import("@/lib/r2");
    expect(vi.mocked(uploadFile)).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a vacant-CEO corporation even when the userId still matches", async () => {
    const corpId = new ObjectId();
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    vi.mocked(resolveCorporation).mockResolvedValue({
      ok: true,
      corporation: { _id: corpId, userId: new ObjectId(userId), ceoVacant: true },
    } as never);

    const { POST } = await import("./route");
    const response = await POST(logoRequest(corpId.toString()));

    expect(response.status).toBe(403);
    expect(db.collectionMocks.corporations.updateOne).not.toHaveBeenCalled();
  });

  it("still serves legacy callers that send no corporation id", async () => {
    const corpId = new ObjectId();
    db.collectionMocks.corporations.findOne.mockResolvedValue({
      _id: corpId,
      userId: new ObjectId(userId),
    });

    const { POST } = await import("./route");
    const response = await POST(logoRequest());

    expect(response.status).toBe(200);
    const { resolveCorporation } = await import("@/lib/api/corporations/resolveQuery");
    expect(vi.mocked(resolveCorporation)).not.toHaveBeenCalled();
    expect(db.collectionMocks.corporations.updateOne).toHaveBeenCalledWith(
      { _id: corpId },
      expect.objectContaining({ $set: expect.objectContaining({ logoUrl: expect.any(String) }) })
    );
  });
});
