import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));
vi.mock("@/lib/countryAccess", () => ({ getEnabledCountryIds: vi.fn() }));

describe("GET /api/game/state-player-counts", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("returns a stateId->count map and scopes to enabled countries for non-admins", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    const { getEnabledCountryIds } = await import("@/lib/countryAccess");
    vi.mocked(getAuthUser).mockResolvedValue(null as never);
    vi.mocked(getEnabledCountryIds).mockResolvedValue(["US"] as never);

    db.collectionMocks.characters = db.collection("characters");
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: "CA", count: 3 },
        { _id: "WY", count: 0 },
      ]),
    });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toEqual({ CA: 3, WY: 0 });

    // Non-admin: aggregation $match scopes by enabled country + excludes retired.
    const pipeline = db.collectionMocks.characters!.aggregate.mock.calls[0]![0] as Array<
      Record<string, unknown>
    >;
    const match = pipeline[0]!.$match as Record<string, unknown>;
    expect(match.countryId).toEqual({ $in: ["US"] });
    expect(match.retiredAt).toEqual({ $exists: false });
  });

  it("does not scope by country for admins", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    const { getEnabledCountryIds } = await import("@/lib/countryAccess");
    vi.mocked(getAuthUser).mockResolvedValue({ isAdmin: true } as never);

    db.collectionMocks.characters = db.collection("characters");
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: "CA", count: 2 }]),
    });

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(200);

    expect(getEnabledCountryIds).not.toHaveBeenCalled();
    const pipeline = db.collectionMocks.characters!.aggregate.mock.calls[0]![0] as Array<
      Record<string, unknown>
    >;
    const match = pipeline[0]!.$match as Record<string, unknown>;
    expect(match.countryId).toBeUndefined();
  });

  it("ignores rows with a null homeState group key", async () => {
    const { getAuthUser } = await import("@/lib/auth");
    vi.mocked(getAuthUser).mockResolvedValue({ isAdmin: true } as never);

    db.collectionMocks.characters = db.collection("characters");
    db.collectionMocks.characters.aggregate.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        { _id: null, count: 9 },
        { _id: "CA", count: 1 },
      ]),
    });

    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.counts).toEqual({ CA: 1 });
  });
});
