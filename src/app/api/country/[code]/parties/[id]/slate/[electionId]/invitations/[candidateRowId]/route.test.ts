import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb, assertSetFields } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({ requireAuthWithCharacter: vi.fn() }));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/db/recruitmentSlateLookup", () => ({ findSlateForElection: vi.fn() }));
vi.mock("@/lib/slateAuthority", () => ({ resolveSlateAuthority: vi.fn() }));
vi.mock("@/lib/electionEngine/tallyCleaner", () => ({
  removeWithdrawnCandidateFromTally: vi.fn(),
}));

const ELECTION_ID = "507f1f77bcf86cd799439011";
const ROW_ID = "507f1f77bcf86cd799439012";
const CANDIDATE_ID = "507f1f77bcf86cd799439013";
const SLATE_ID = "507f1f77bcf86cd799439014";

function deleteRequest(): Request {
  return new Request(
    `http://localhost/api/country/us/parties/1/slate/${ELECTION_ID}/invitations/${ROW_ID}`,
    { method: "DELETE" }
  );
}

function routeParams() {
  return {
    params: Promise.resolve({
      code: "us",
      id: "1",
      electionId: ELECTION_ID,
      candidateRowId: ROW_ID,
    }),
  };
}

describe("DELETE .../slate/[electionId]/invitations/[candidateRowId]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();
    // Pre-instantiate the collections these tests set expectations on
    // (createMockDb creates collection mocks lazily on first access).
    db.collection("slateCandidates");
    db.collection("elections");
    db.collection("electionCandidates");
    db.collection("campaigns");

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

    const { findSlateForElection } = await import("@/lib/db/recruitmentSlateLookup");
    vi.mocked(findSlateForElection).mockResolvedValue({
      _id: new ObjectId(SLATE_ID),
      countryId: "US",
      partyId: "1",
      electionId: new ObjectId(ELECTION_ID),
      state: "US_NY",
    } as never);

    const { resolveSlateAuthority } = await import("@/lib/slateAuthority");
    vi.mocked(resolveSlateAuthority).mockResolvedValue({
      canManage: true,
      assignerRole: "state_chair",
      assignerRoleLabel: "State / Regional Party Chair",
      getsStateAcceptanceBuff: true,
    } as never);
  });

  it("tombstones (withdrawn) an invited row instead of hard-deleting it", async () => {
    // A hard delete empties the slate and lets syncPersistentSlateAssignments
    // re-hydrate the candidate from the cross-cycle template next turn (the
    // revert bug). Tombstoning keeps the slate non-empty and blocks re-hydration.
    db.collectionMocks["slateCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId(ROW_ID),
      slateId: new ObjectId(SLATE_ID),
      candidateId: new ObjectId(CANDIDATE_ID),
      status: "invited",
    });

    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), routeParams());

    expect(response.status).toBe(200);
    expect(db.collectionMocks["slateCandidates"]!.deleteOne).not.toHaveBeenCalled();
    assertSetFields(db.collectionMocks["slateCandidates"]!.updateOne, { status: "withdrawn" });
  });

  it("tombstones a filed row and still withdraws the live candidacy", async () => {
    db.collectionMocks["slateCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId(ROW_ID),
      slateId: new ObjectId(SLATE_ID),
      candidateId: new ObjectId(CANDIDATE_ID),
      status: "filed",
    });
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(ELECTION_ID),
      countryId: "US",
      status: "active",
    });
    db.collectionMocks["electionCandidates"]!.findOne.mockResolvedValue({
      _id: new ObjectId("507f1f77bcf86cd799439015"),
      characterId: new ObjectId(CANDIDATE_ID),
      status: "active",
    });

    const { DELETE } = await import("./route");
    const response = await DELETE(deleteRequest(), routeParams());

    expect(response.status).toBe(200);
    // Live candidacy is pulled off the ballot (existing behavior preserved).
    assertSetFields(db.collectionMocks["electionCandidates"]!.updateOne, { status: "withdrawn" });
    // Slate row is tombstoned, not deleted.
    expect(db.collectionMocks["slateCandidates"]!.deleteOne).not.toHaveBeenCalled();
    assertSetFields(db.collectionMocks["slateCandidates"]!.updateOne, { status: "withdrawn" });
  });
});
