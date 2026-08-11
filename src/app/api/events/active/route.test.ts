import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/events/featureFlag", () => ({
  isPlayerRandomEventsEnabled: vi.fn(),
  isWorldEventsEnabled: vi.fn(),
}));
vi.mock("@/lib/api/headOfGovernment", () => ({
  getHeadOfGovernmentCharacterId: vi.fn(),
}));

const characterId = new ObjectId();

describe("GET /api/events/active", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("eventInstances");
    db.collection("eventDefinitions");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as never);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { userId: "user-1", character: { _id: characterId, countryId: "US" } },
    } as never);

    // World Events is off by default in these character-scope tests; the
    // country-scope branch is covered separately.
    const { isWorldEventsEnabled } = await import("@/lib/events/featureFlag");
    vi.mocked(isWorldEventsEnabled).mockResolvedValue(false);
  });

  it("returns event: null when the feature flag is off, without querying instances", async () => {
    const { isPlayerRandomEventsEnabled } = await import("@/lib/events/featureFlag");
    vi.mocked(isPlayerRandomEventsEnabled).mockResolvedValue(false);

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ event: null, lastResolved: null });
    expect(db.collectionMocks.eventInstances!.findOne).not.toHaveBeenCalled();
  });

  it("returns event: null when the flag is on but no instance is pending", async () => {
    const { isPlayerRandomEventsEnabled } = await import("@/lib/events/featureFlag");
    vi.mocked(isPlayerRandomEventsEnabled).mockResolvedValue(true);
    db.collectionMocks.eventInstances!.findOne.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ event: null, lastResolved: null });
  });
});
