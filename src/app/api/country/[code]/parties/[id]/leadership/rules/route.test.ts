import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/time/gameTime", () => ({ getGameTime: vi.fn() }));
vi.mock("@/lib/uk/leadership/leadershipCommands", () => ({ amendLeadershipRules: vi.fn() }));

const NOW = new Date("2026-09-17T00:00:00Z");

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/country/uk/parties/2/leadership/rules", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function setup() {
  const errors = await import("@/lib/api/errors");
  const { getDb } = await import("@/lib/mongodb");
  const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  const { getGameTime } = await import("@/lib/time/gameTime");
  const { amendLeadershipRules } = await import("@/lib/uk/leadership/leadershipCommands");
  return {
    errors,
    getDb,
    requireAuthWithCharacter,
    findPartyBySequentialId,
    getGameTime,
    amendLeadershipRules,
  };
}

describe("PATCH /api/country/[code]/parties/[id]/leadership/rules", () => {
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
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "committee",
        isAdmin: false,
        isBanned: false,
        character: { _id: characterId, name: "Committee Kate", party: "2", countryId: "UK" },
      },
    } as never);
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

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects an invalid country code", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "zz", id: "2" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 when the party is not found", async () => {
    const { findPartyBySequentialId } = await setup();
    vi.mocked(findPartyBySequentialId).mockResolvedValue(null);

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "uk", id: "9" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns 403 for characters outside this party", async () => {
    const { requireAuthWithCharacter, amendLeadershipRules } = await setup();
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "other",
        isAdmin: false,
        character: { _id: new ObjectId(), name: "Other", party: "3", countryId: "UK" },
      },
    } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect(vi.mocked(amendLeadershipRules)).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies", async () => {
    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest("{not json"), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects wrongly typed amendment fields", async () => {
    const { PATCH } = await import("./route");
    for (const body of [
      { triggerThresholdPct: "high" },
      { electorate: "everyone" },
      { removalMajorityPct: [0.6] },
    ]) {
      const response = await PATCH(makeRequest(body), {
        params: Promise.resolve({ code: "uk", id: "2" }),
      });
      expect(response.status).toBe(400);
    }
  });

  it("amends the ruleset and returns the command payload", async () => {
    const { amendLeadershipRules } = await setup();
    const ruleset = {
      triggerThresholdPct: 0.2,
      electorate: "mps",
      removalMajorityPct: 0.5,
      survivalImmunityTurns: 48,
    };
    vi.mocked(amendLeadershipRules).mockResolvedValue({ success: true, ruleset } as never);

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, ruleset });
    expect(vi.mocked(amendLeadershipRules)).toHaveBeenCalledWith(
      db,
      "UK",
      "2",
      { _id: characterId, name: "Committee Kate", party: "2" },
      { triggerThresholdPct: 0.2 },
      100,
      NOW
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("delegates committee gating to the command: non-committee members surface as 403", async () => {
    // The route checks party membership only; the committee seat check lives
    // in the command, so a plain party member reaches the command and the
    // command's forbidden maps to 403 here.
    const { amendLeadershipRules, errors } = await setup();
    vi.mocked(amendLeadershipRules).mockRejectedValue(
      errors.forbidden("Only the party committee can amend leadership rules")
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/party committee/);
  });

  it("maps an out-of-bounds amendment to 400", async () => {
    const { amendLeadershipRules, errors } = await setup();
    vi.mocked(amendLeadershipRules).mockRejectedValue(
      errors.badRequest("triggerThresholdPct: must be between 0.05 and 0.5")
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.9 }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(400);
  });

  it("maps the amendment cooldown to 409", async () => {
    const { amendLeadershipRules, errors } = await setup();
    vi.mocked(amendLeadershipRules).mockRejectedValue(
      errors.conflict(
        "Leadership rules were amended recently and cannot be changed for 20 more turn(s)"
      )
    );

    const { PATCH } = await import("./route");
    const response = await PATCH(makeRequest({ triggerThresholdPct: 0.2 }), {
      params: Promise.resolve({ code: "uk", id: "2" }),
    });
    expect(response.status).toBe(409);
  });
});
