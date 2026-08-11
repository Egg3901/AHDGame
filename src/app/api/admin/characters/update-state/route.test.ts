import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/character/performRelocation", () => ({ performRelocation: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  db.collection("users");
  db.collection("characters");
  db.collection("states");
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

  const { requireAdmin } = await import("@/lib/api/requireAdmin");
  vi.mocked(requireAdmin).mockResolvedValue({
    ok: true,
    admin: { userId: "admin1", username: "admin1" },
  } as Awaited<ReturnType<typeof requireAdmin>>);

  const { performRelocation } = await import("@/lib/character/performRelocation");
  vi.mocked(performRelocation).mockResolvedValue(
    {} as Awaited<ReturnType<typeof performRelocation>>
  );
});

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/characters/update-state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Seeds a user + character in `countryId`, and a `states` row that only
 * resolves for the matching (id, country) pair — mirroring the route's
 * country-scoped lookup.
 */
function seedCharacter(countryId: string, homeState: string, resolvableStateId: string) {
  db.collectionMocks.users!.findOne.mockResolvedValue({ _id: "u1", username: "player1" });
  db.collectionMocks.characters!.findOne.mockResolvedValue({
    _id: "c1",
    userId: "u1",
    name: "Test Player",
    countryId,
    homeState,
  });
  db.collectionMocks.states!.findOne.mockImplementation(
    (filter: { _id?: string; countryId?: string }) =>
      Promise.resolve(
        filter?._id === resolvableStateId && filter?.countryId === countryId
          ? { _id: resolvableStateId, countryId, name: "Target Region" }
          : null
      )
  );
}

describe("PATCH /api/admin/characters/update-state", () => {
  it("relocates a US character to a US state", async () => {
    seedCharacter("US", "CA", "NY");
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ username: "player1", homeState: "NY" }));

    expect(res.status).toBe(200);
    const { performRelocation } = await import("@/lib/character/performRelocation");
    expect(performRelocation).toHaveBeenCalled();
  });

  it("relocates a UK character to a UK region", async () => {
    seedCharacter("UK", "LON", "SEE");
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ username: "player1", homeState: "SEE" }));

    expect(res.status).toBe(200);
    const { performRelocation } = await import("@/lib/character/performRelocation");
    expect(performRelocation).toHaveBeenCalled();
  });

  it("relocates a Soviet character to a Soviet region", async () => {
    seedCharacter("RU", "URA", "CEN");
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ username: "player1", homeState: "CEN" }));

    expect(res.status).toBe(200);
  });

  it("still rejects a region that does not exist in the character's country", async () => {
    seedCharacter("UK", "LON", "SEE");
    const { PATCH } = await import("./route");

    // NY is a real US state, but this character is British.
    const res = await PATCH(patchRequest({ username: "player1", homeState: "NY" }));

    expect(res.status).toBe(400);
    // The message must name the country searched — picking the wrong country in
    // the panel is now the likeliest cause, and a bare "not found" hides that.
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("UK");
    const { performRelocation } = await import("@/lib/character/performRelocation");
    expect(performRelocation).not.toHaveBeenCalled();
  });

  it("rejects an empty home state", async () => {
    seedCharacter("UK", "LON", "SEE");
    const { PATCH } = await import("./route");

    const res = await PATCH(patchRequest({ username: "player1", homeState: "" }));

    expect(res.status).toBe(400);
  });
});
