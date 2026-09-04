import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/caucusLookup", () => ({
  findCaucusBySlug: vi.fn(),
  listCaucusMemberships: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/api/rateLimit", () => ({
  checkRateLimit: vi.fn(() => ({ ok: true })),
  rateLimitResponse: vi.fn(),
}));

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/country/de/parties/1/caucuses/test-caucus/whip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/country/[code]/parties/[id]/caucuses/[slug]/whip", () => {
  let db: MockDb;
  let chairId: ObjectId;
  let caucusId: ObjectId;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();
    caucusId = new ObjectId();
    db.collection("billWhips");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        isAdmin: false,
        character: { _id: chairId },
      },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "DE",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);

    const { findCaucusBySlug } = await import("@/lib/db/caucusLookup");
    vi.mocked(findCaucusBySlug).mockResolvedValue({
      caucus: {
        _id: caucusId,
        name: "Test Caucus",
        slug: "test-caucus",
        chairId,
      },
    } as never);
  });

  it("rejects leadershipElection whips on the Bundestag chamber", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        targetType: "leadershipElection",
        targetId: new ObjectId().toString(),
        chamber: "bundestag",
        direction: "for",
        candidacyId: new ObjectId().toString(),
      }),
      {
        params: Promise.resolve({ code: "de", id: "1", slug: "test-caucus" }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("not supported for German chambers"),
    });
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects speakerElection whips on the Landtag chamber", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      makeRequest({
        audience: "character",
        targetType: "speakerElection",
        targetId: new ObjectId().toString(),
        chamber: "landtag",
        direction: "for",
        candidacyId: new ObjectId().toString(),
      }),
      {
        params: Promise.resolve({ code: "de", id: "1", slug: "test-caucus" }),
      }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("not supported for German chambers"),
    });
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });
});

describe("POST caucus whip — motion to vacate", () => {
  let db: MockDb;
  let chairId: ObjectId;
  let caucusId: ObjectId;

  function usRequest(body: Record<string, unknown>) {
    return new Request("http://localhost/api/country/us/parties/1/caucuses/test-caucus/whip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const vacateBody = {
    audience: "character",
    targetType: "speakerVacateMotion",
    targetId: "current",
    chamber: "house",
    direction: "for",
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    chairId = new ObjectId();
    caucusId = new ObjectId();
    db.collection("billWhips");
    db.collection("speakerVacateMotions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId().toString(), isAdmin: false, character: { _id: chairId } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);

    const { findCaucusBySlug } = await import("@/lib/db/caucusLookup");
    vi.mocked(findCaucusBySlug).mockResolvedValue({
      caucus: { _id: caucusId, name: "Test Caucus", slug: "test-caucus", chairId },
    } as never);
  });

  it("rejects a motion-to-vacate whip outside the US", async () => {
    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "DE",
      isDefault: true,
      chairId,
      viceChairId: null,
    } as never);

    const { POST } = await import("./route");
    const response = await POST(makeRequest({ ...vacateBody, chamber: "bundestag" }), {
      params: Promise.resolve({ code: "de", id: "1", slug: "test-caucus" }),
    });

    expect(response.status).toBe(400);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("404s when no motion to vacate is open", async () => {
    db.collectionMocks["speakerVacateMotions"]!.findOne.mockResolvedValue(null);

    const { POST } = await import("./route");
    const response = await POST(usRequest(vacateBody), {
      params: Promise.resolve({ code: "us", id: "1", slug: "test-caucus" }),
    });

    expect(response.status).toBe(404);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });

  it("rejects a chamber other than the House", async () => {
    const { POST } = await import("./route");
    const response = await POST(usRequest({ ...vacateBody, chamber: "senate" }), {
      params: Promise.resolve({ code: "us", id: "1", slug: "test-caucus" }),
    });

    expect(response.status).toBe(400);
    expect(db.collectionMocks["billWhips"]!.insertOne).not.toHaveBeenCalled();
  });
});
