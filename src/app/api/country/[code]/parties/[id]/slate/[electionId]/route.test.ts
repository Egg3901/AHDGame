import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/api/requireAuth", () => ({
  requireAuth: vi.fn(),
  requireAuthWithCharacter: vi.fn(),
}));
vi.mock("@/lib/db/partyLookup", () => ({ findPartyBySequentialId: vi.fn() }));
vi.mock("@/lib/elections/resolveElection", () => ({ resolveElection: vi.fn() }));
vi.mock("@/lib/elections/mapElectionResponseToDisplay", () => ({
  mapElectionResponseToDisplay: vi.fn(() => null),
}));
vi.mock("@/lib/db/recruitmentSlateLookup", () => ({
  ensureSlate: vi.fn(),
  findSlateForElection: vi.fn(),
  isSlateRowVisibleToChair: vi.fn(() => true),
  listSlateCandidates: vi.fn(),
  listStateAssignedCandidateIds: vi.fn(async () => []),
  materializeSlateAssignmentsFromTemplate: vi.fn(async () => null),
}));

const ELECTION_ID = "507f1f77bcf86cd799439011";
const SLATE_ID = "507f1f77bcf86cd799439014";

interface AssignmentPayload {
  assignment: { cap: number; used: number; remaining: number };
}

function getRequest(): Request {
  return new Request("http://localhost/api/country/uk/parties/1/slate/" + ELECTION_ID);
}

async function callGet() {
  const { GET } = await import("./route");
  return GET(getRequest(), {
    params: Promise.resolve({ code: "uk", id: "1", electionId: ELECTION_ID }),
  });
}

describe("GET .../slate/[electionId]", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    db = createMockDb();

    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);

    const { requireAuth } = await import("@/lib/api/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      ok: true,
      user: { userId: new ObjectId(), isAdmin: false, character: { _id: new ObjectId() } },
    } as never);

    const { findPartyBySequentialId } = await import("@/lib/db/partyLookup");
    vi.mocked(findPartyBySequentialId).mockResolvedValue({
      sequentialId: 1,
      countryId: "UK",
      name: "Labour Party",
    } as never);

    db.collection("elections");
    db.collectionMocks["elections"]!.findOne.mockResolvedValue({
      _id: new ObjectId(ELECTION_ID),
      countryId: "UK",
      electionType: "commons",
      state: "NEE",
      status: "active",
      cycle: 4,
    });

    const { resolveElection } = await import("@/lib/elections/resolveElection");
    vi.mocked(resolveElection).mockResolvedValue({ id: ELECTION_ID } as never);
  });

  function stubFind(collection: string, docs: unknown[]) {
    db.collection(collection);
    db.collectionMocks[collection]!.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue(docs),
    });
  }

  function activeNppCandidacy(id: string) {
    return { characterId: new ObjectId(id), status: "active", isNPP: true };
  }

  it("reports the cap on a race whose slate has not been opened yet", async () => {
    stubFind("electionCandidates", []);

    const response = await callGet();

    expect(response.status).toBe(200);
    const body = (await response.json()) as AssignmentPayload;
    expect(body.assignment).toEqual({ cap: 3, used: 0, remaining: 3 });
  });

  it("counts autopilot candidacies on a race with no slate rows", async () => {
    stubFind("electionCandidates", [
      activeNppCandidacy("507f1f77bcf86cd799439021"),
      activeNppCandidacy("507f1f77bcf86cd799439022"),
    ]);

    const response = await callGet();

    const body = (await response.json()) as AssignmentPayload;
    expect(body.assignment).toEqual({ cap: 3, used: 2, remaining: 1 });
  });

  it("counts live slate rows and the autopilot pick beside them", async () => {
    const { findSlateForElection, listSlateCandidates } =
      await import("@/lib/db/recruitmentSlateLookup");
    vi.mocked(findSlateForElection).mockResolvedValue({
      _id: new ObjectId(SLATE_ID),
      electionId: new ObjectId(ELECTION_ID),
      electionType: "commons",
      state: "NEE",
      priority: "none",
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    vi.mocked(listSlateCandidates).mockResolvedValue([
      {
        _id: new ObjectId(),
        candidateType: "npp",
        candidateId: new ObjectId("507f1f77bcf86cd799439021"),
        candidateName: "Daniel Taylor",
        homeState: "NEE",
        status: "filed",
        fitScore: 50,
        refusalReason: null,
        autoFilled: true,
        invitedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        candidateType: "character",
        candidateId: new ObjectId("507f1f77bcf86cd799439022"),
        candidateName: "Clive Lewis",
        homeState: "NEE",
        status: "accepted",
        fitScore: 100,
        refusalReason: null,
        autoFilled: false,
        invitedAt: new Date(),
      },
    ] as never);
    stubFind("electionCandidates", [
      // Same NPP as the filed row above: one slot, not two.
      activeNppCandidacy("507f1f77bcf86cd799439021"),
      activeNppCandidacy("507f1f77bcf86cd799439023"),
    ]);

    const response = await callGet();

    const body = (await response.json()) as AssignmentPayload;
    expect(body.assignment).toEqual({ cap: 3, used: 3, remaining: 0 });
  });
});
