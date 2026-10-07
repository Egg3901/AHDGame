import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/db/partyLookup")>("@/lib/db/partyLookup");
  return {
    ...actual,
    findPartyBySequentialId: vi.fn(),
  };
});
vi.mock("@/lib/imageOptimize", () => ({
  IMAGE_PRESETS: { partyLogo: {} },
  optimizeImage: vi.fn(async () => ({ buffer: Buffer.from("optimized"), ext: "png" })),
}));
vi.mock("@/lib/r2", () => ({
  isR2Enabled: vi.fn(() => true),
  deleteByPrefix: vi.fn(async () => undefined),
  uploadFile: vi.fn(async (pathname: string) => `https://cdn.example/${pathname}`),
}));

describe("POST /api/upload/party-logo", () => {
  let db: MockDb;
  let originalR2Key: string | undefined;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("characters");
    db.collection("politicalParties");

    originalR2Key = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = "test-key";

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  async function authAs(characterId: ObjectId) {
    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        hasCharacter: true,
        character: { _id: characterId },
      },
    } as never);
  }

  function logoForm() {
    const formData = new FormData();
    formData.append("partyId", "1abc");
    formData.append("country", "us");
    formData.append("file", new Blob(["raw"], { type: "image/png" }), "logo.png");
    return formData;
  }

  afterEach(() => {
    if (originalR2Key === undefined) {
      delete process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    } else {
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = originalR2Key;
    }
  });

  it("uses the resolved party sequential id for R2 cleanup and upload keys", async () => {
    const chairId = new ObjectId();
    await authAs(chairId);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
      chairId,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/upload/party-logo", { method: "POST", body: logoForm() })
    );

    const { deleteByPrefix, uploadFile } = await import("@/lib/r2");

    expect(response.status).toBe(200);
    expect(vi.mocked(deleteByPrefix)).toHaveBeenCalledWith("party-logos/us-1-");
    expect(vi.mocked(uploadFile)).toHaveBeenCalledWith(
      expect.stringMatching(/^party-logos\/us-1-\d+\.png$/),
      expect.any(Buffer)
    );
  });

  it("checks the active character, not another character on the same account", async () => {
    const chairId = new ObjectId();
    // A second character on the account would be returned by a userId lookup.
    db.collectionMocks.characters.findOne.mockResolvedValue({ _id: new ObjectId() });
    await authAs(chairId);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
      chairId,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/upload/party-logo", { method: "POST", body: logoForm() })
    );

    expect(response.status).toBe(200);
    expect(db.collectionMocks.characters.findOne).not.toHaveBeenCalled();
  });

  it("rejects a character that is not the chair", async () => {
    await authAs(new ObjectId());

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: "party-us-1",
      sequentialId: 1,
      countryId: "US",
      chairId: new ObjectId(),
    } as never);

    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost/api/upload/party-logo", { method: "POST", body: logoForm() })
    );

    expect(response.status).toBe(403);
  });
});
