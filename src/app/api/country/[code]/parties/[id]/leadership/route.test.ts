import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/uk/leadership/leadershipCommands", () => ({ getLeadershipState: vi.fn() }));

const NOW = new Date("2026-09-17T00:00:00Z");

function makeRequest() {
  return new Request("http://localhost/api/country/uk/parties/2/leadership");
}

async function setup() {
  const errors = await import("@/lib/api/errors");
  const { getDb } = await import("@/lib/mongodb");
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  const { getGameTime } = await import("@/lib/time/gameTime");
  const { getLeadershipState } = await import("@/lib/uk/leadership/leadershipCommands");
  return {
    errors,
    getDb,
    requireAuthWithCharacter,
    findPartyBySequentialId,
    getGameTime,
    getLeadershipState,
  };
}

function memberAuth(characterId: ObjectId) {
  return {
    ok: true,
    user: {
      userId: new ObjectId().toString(),
      username: "mp",
      isAdmin: false,
      isBanned: false,
      character: { _id: characterId, name: "MP One", party: "2", countryId: "UK" },
    },
  } as never;
}

describe("GET /api/country/[code]/parties/[id]/leadership", () => {
  let db: MockDb;
  let characterId: ObjectId;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("politicalParties");
    characterId = new ObjectId();

    const { getDb, requireAuthWithCharacter, findPartyBySequentialId, getGameTime } = await setup();
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(memberAuth(characterId));
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      _id: new ObjectId(),
      sequentialId: 2,
      countryId: "UK",
      name: "Conservative Party",
    } as never);
    vi.mocked(getGameTime).mockResolvedValue({ currentTurn: 100, effectiveNow: NOW } as never);
  });

  it("returns 401 when unauthenticated", async () => {
    const { requireAuthWithCharacter } = await setup();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as never);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "2" }) });
    expect(response.status).toBe(401);
  });

  it("returns 403 for banned accounts", async () => {
    const { requireAuthWithCharacter } = await setup();
    const auth = memberAuth(characterId);
    auth.user.isBanned = true;
    vi.mocked(requireAuthWithCharacter).mockResolvedValue(auth);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "2" }) });
    expect(response.status).toBe(403);
  });

  it("rejects an invalid country code", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "zz", id: "2" }) });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the party is not found", async () => {
    const { findPartyBySequentialId } = await setup();
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "9" }) });
    expect(response.status).toBe(404);
  });

  it("delegates membership to the command: outsiders read with restricted capabilities", async () => {
    // Unlike the mutating endpoints, the state read has no route-level
    // membership gate: the command computes per-viewer capabilities
    // (isPartyMember false) and the panel disables controls from those.
    const { requireAuthWithCharacter, getLeadershipState } = await setup();
    const outsiderId = new ObjectId();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "other",
        isAdmin: false,
        character: { _id: outsiderId, name: "Other", party: "3", countryId: "UK" },
      },
    } as never);
    vi.mocked(getLeadershipState).mockResolvedValue({
      capabilities: { isPartyMember: false, canInitiate: false },
    } as never);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "2" }) });
    expect(response.status).toBe(200);
    expect(vi.mocked(getLeadershipState)).toHaveBeenCalledWith(
      db,
      "UK",
      "2",
      { _id: outsiderId, name: "Other", party: "3" },
      100,
      NOW
    );
    expect((await response.json()).capabilities.isPartyMember).toBe(false);
  });

  it("returns the viewer-scoped state on success", async () => {
    const { getLeadershipState } = await setup();
    const state = { partyName: "Conservative Party", capabilities: { canInitiate: true } };
    vi.mocked(getLeadershipState).mockResolvedValue(state as never);

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "2" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state);
    expect(vi.mocked(getLeadershipState)).toHaveBeenCalledWith(
      db,
      "UK",
      "2",
      { _id: characterId, name: "MP One", party: "2" },
      100,
      NOW
    );
  });

  it("maps command authorization failures to their status (role gating lives in the command)", async () => {
    const { getLeadershipState, errors } = await setup();
    vi.mocked(getLeadershipState).mockRejectedValue(
      errors.forbidden("Only party members may view")
    );

    const { GET } = await import("./route");
    const response = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "2" }) });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/party members/);
  });

  it("stamps Cache-Control: no-store on success and error bodies", async () => {
    const { getLeadershipState, findPartyBySequentialId } = await setup();
    vi.mocked(getLeadershipState).mockResolvedValue({ partyName: "Conservative Party" } as never);

    const { GET } = await import("./route");
    const ok = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "2" }) });
    expect(ok.headers.get("Cache-Control")).toContain("no-store");

    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);
    const missing = await GET(makeRequest(), { params: Promise.resolve({ code: "uk", id: "9" }) });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toContain("no-store");
  });
});
