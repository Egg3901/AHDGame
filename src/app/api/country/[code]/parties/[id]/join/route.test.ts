/**
 * Growth-frontier gate on joining a party.
 *
 * `partyFrontier` is mocked: its behaviour is unit-tested in
 * `src/lib/parties/partyFrontier.test.ts`. This file proves the wiring — that
 * the gate runs before the approval-mode branch, so an ineligible player can
 * neither join outright nor file a pending request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn().mockResolvedValue(900) }));
vi.mock("@/lib/db/partyLookup", async () => {
  const actual = await vi.importActual<object>("@/lib/db/partyLookup");
  return { ...actual, findPartyBySequentialId: vi.fn() };
});
vi.mock("@/lib/parties/partyFrontier", () => ({ canCharacterJoinParty: vi.fn() }));
vi.mock("@/lib/parties/applyCharacterPartyJoin", () => ({
  applyCharacterPartyJoin: vi.fn().mockResolvedValue({ becameChair: false }),
}));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

const characterId = new ObjectId();
const partyObjectId = new ObjectId();

function makeRequest() {
  return new Request("http://localhost/api/country/us/parties/7/join", { method: "POST" });
}

const params = Promise.resolve({ code: "us", id: "7" });

async function setParty(membershipMode: "open" | "approval") {
  const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
  vi.mocked(findPartyBySequentialId).mockResolvedValue({
    _id: partyObjectId,
    sequentialId: 7,
    countryId: "US",
    name: "Northeast Labor Party",
    abbreviation: "NLP",
    isDefault: false,
    chairId: new ObjectId(),
    membershipMode,
    pendingJoinRequests: [],
  } as never);
}

describe("POST join — growth frontier gate", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: {
        userId: new ObjectId().toString(),
        username: "player",
        isAdmin: false,
        hasCharacter: true,
        character: {
          _id: characterId,
          name: "Player",
          countryId: "US",
          homeState: "CA",
          party: "independent",
          purgeRejoinBlocks: [],
        },
      },
    } as never);

    db.collection("gameConfig").findOne.mockResolvedValue({ firstJoinerBecomesPartyChair: true });
    db.collection("gameState").findOne.mockResolvedValue({ freePartyMovesOpen: false });
    await setParty("open");
  });

  it("blocks a joiner whose home region is outside the party frontier", async () => {
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({
      ok: false,
      error: "Northeast Labor Party is not established in or next to your home region.",
    });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("not established in or next to");

    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(vi.mocked(applyCharacterPartyJoin)).not.toHaveBeenCalled();
  });

  it("does not file a pending request for an out-of-frontier joiner", async () => {
    await setParty("approval");
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({ ok: false, error: "nope" });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(db.collection("politicalParties").updateOne).not.toHaveBeenCalled();
  });

  it("allows a joiner inside the frontier", async () => {
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({ ok: true });

    const { POST } = await import("./route");
    const res = await POST(makeRequest(), { params });

    expect(res.status).toBe(200);
    const { applyCharacterPartyJoin } = await import("@/lib/parties/applyCharacterPartyJoin");
    expect(vi.mocked(applyCharacterPartyJoin)).toHaveBeenCalledOnce();
  });

  it("consults the gate with the joining character and the target party", async () => {
    const { canCharacterJoinParty } = await import("@/lib/parties/partyFrontier");
    vi.mocked(canCharacterJoinParty).mockResolvedValue({ ok: true });

    const { POST } = await import("./route");
    await POST(makeRequest(), { params });

    const [, charArg, partyArg, countryArg] = vi.mocked(canCharacterJoinParty).mock.calls[0];
    expect((charArg as { homeState: string }).homeState).toBe("CA");
    expect((partyArg as { sequentialId: number }).sequentialId).toBe(7);
    expect(countryArg).toBe("US");
  });
});
