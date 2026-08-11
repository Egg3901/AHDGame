import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/slateAuthority", () => ({
  resolveSlateAuthority: vi.fn(),
  getSlateAcceptanceStatBonus: vi.fn(),
}));
vi.mock("@/lib/turn/currentTurn", () => ({ getCurrentTurn: vi.fn() }));

const ELECTION_ID = "507f1f77bcf86cd799439011";
const CANDIDATE_ID = "507f1f77bcf86cd799439012";

function postRequest(body: Record<string, unknown>): Request {
  return new Request(
    "http://localhost/api/country/us/parties/1/slate/" + ELECTION_ID + "/invitations",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

describe("POST .../slate/[electionId]/invitations", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("elections");

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuthWithCharacter } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuthWithCharacter).mockResolvedValue({
      ok: true,
      user: { isAdmin: false, character: { _id: new ObjectId(), name: "Chair" } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "US",
      name: "Test Party",
    } as never);

    const { resolveSlateAuthority } = await import("@/lib/slateAuthority");
    vi.mocked(resolveSlateAuthority).mockResolvedValue({
      canManage: true,
      assignerRole: "national_chair",
      assignerRoleLabel: "National Chair",
      getsStateAcceptanceBuff: false,
    } as never);

    const { getCurrentTurn } = await import("@/lib/turn/currentTurn");
    vi.mocked(getCurrentTurn).mockResolvedValue(10);
  });

  it("rejects assigning a candidate once the primary has closed (general phase)", async () => {
    // General phase: status still "active" but the primary boundary has passed.
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(ELECTION_ID),
      countryId: "US",
      electionType: "house",
      state: "US_AZ",
      status: "active",
      primaryEndTurn: 5,
    });

    const { POST } = await import("./route");
    const response = await POST(postRequest({ candidateType: "npp", candidateId: CANDIDATE_ID }), {
      params: Promise.resolve({ code: "us", id: "1", electionId: ELECTION_ID }),
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/primary has ended/i);
  });

  it("allows assigning a candidate while the primary is still open", async () => {
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(ELECTION_ID),
      countryId: "US",
      electionType: "house",
      state: "US_AZ",
      status: "active",
      primaryEndTurn: 20, // currentTurn 10 < 20 → primary still open
    });

    const { POST } = await import("./route");
    const response = await POST(postRequest({ candidateType: "npp", candidateId: CANDIDATE_ID }), {
      params: Promise.resolve({ code: "us", id: "1", electionId: ELECTION_ID }),
    });

    // Past the primary-phase gate: it proceeds into NPP-control / slate logic
    // (which this test does not fully wire), so it must NOT return the
    // primary-closed 409.
    if (response.status === 409) {
      const body = (await response.json()) as { error: string };
      expect(body.error).not.toMatch(/primary has ended/i);
    }
  });
});
