import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn().mockReturnValue({ ok: true }),
  rateLimitResponse: vi.fn(),
}));
vi.mock("@/lib/r2", () => ({
  isR2Enabled: vi.fn().mockReturnValue(true),
  uploadFile: vi.fn().mockResolvedValue("https://r2.example/cabinet-banners/chancellor-123.png"),
  deleteByPrefix: vi.fn().mockResolvedValue(undefined),
}));

const { getDb } = await import("@/lib/mongodb");
const { requireAuth } = await import("@/lib/api/requireAuth");

function makeFormDataRequest(file: Blob | null): Request {
  const fd = new FormData();
  if (file) fd.set("file", file);
  return new Request("http://localhost/api/country/uk/executive/cabinet/chancellor/banner", {
    method: "POST",
    body: fd,
  });
}

function makePngBlob(sizeBytes = 256): Blob {
  return new Blob([new Uint8Array(sizeBytes)], { type: "image/png" });
}

describe("POST /api/country/[code]/executive/cabinet/[positionId]/banner", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: "user_1",
        isAdmin: false,
        character: { _id: { toString: () => "char_1" } },
      },
    } as never);

    db.collection("cabinetMembers");
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "member_1",
      countryId: "UK",
      positionId: "chancellor",
      characterId: { toString: () => "char_1" },
    });
  });

  it("rejects requests with no file uploaded with 400", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(null), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("No file uploaded");
  });

  it("returns 404 when no cabinet member holds the position", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue(null);

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(makePngBlob()), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("No cabinet member");
  });

  it("rejects unknown country with 400", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(makePngBlob()), {
      params: Promise.resolve({ code: "xx", positionId: "chancellor" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid country");
  });

  it("rejects non-holder non-admin with 403", async () => {
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "member_1",
      countryId: "UK",
      positionId: "chancellor",
      characterId: { toString: () => "char_other" }, // different character
    });

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(makePngBlob()), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects oversized files with 400", async () => {
    const fiveMB = 5 * 1024 * 1024;
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(makePngBlob(fiveMB)), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain("4 MB");
  });

  it("rejects disallowed mime types with 400", async () => {
    const bmp = new Blob([new Uint8Array(64)], { type: "image/bmp" });
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(bmp), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(400);
  });

  it("writes bannerImageUrl to unified cabinetMembers collection on success", async () => {
    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(makePngBlob()), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toMatch(/cabinet-banners\/chancellor-/);

    // Looked up the member via the unified collection scoped by countryId+positionId
    expect(db.collectionMocks.cabinetMembers.findOne).toHaveBeenCalledWith({
      countryId: "UK",
      positionId: "chancellor",
    });

    // Wrote bannerImageUrl back to the unified collection (the bugfix)
    expect(db.collectionMocks.cabinetMembers.updateOne).toHaveBeenCalledWith(
      { _id: "member_1" },
      expect.objectContaining({
        $set: expect.objectContaining({
          bannerImageUrl: expect.stringMatching(/cabinet-banners\/chancellor-/),
        }),
      })
    );
  });

  it("admin can upload for a position they don't hold", async () => {
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: {
        userId: "admin_1",
        isAdmin: true,
        character: { _id: { toString: () => "admin_char" } },
      },
    } as never);
    db.collectionMocks.cabinetMembers.findOne.mockResolvedValue({
      _id: "member_1",
      countryId: "UK",
      positionId: "chancellor",
      characterId: { toString: () => "char_other" },
    });

    const { POST } =
      await import("@/app/api/country/[code]/executive/cabinet/[positionId]/banner/route");

    const response = await POST(makeFormDataRequest(makePngBlob()), {
      params: Promise.resolve({ code: "uk", positionId: "chancellor" }),
    });

    expect(response.status).toBe(200);
  });
});
