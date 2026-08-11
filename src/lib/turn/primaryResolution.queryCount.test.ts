/**
 * Query-count regression guard for resolvePrimariesIfNeeded (perf audit
 * 2026-08-03).
 *
 * The resolution loop used to fetch `characters` (and `npps`) once per
 * resolving election, plus a second per-election `characters` fetch for the
 * notification block — O(2N) round-trips on a turn resolving N primaries. Both
 * now ride ONE batched `$in` query issued before the loop. This test resolves
 * two contested primaries at once and pins the single-fetch shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/notifications", () => ({
  createNotifications: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/achievements", () => ({
  awardAchievement: vi.fn(),
  resolveUserIdFromCharacter: vi.fn().mockResolvedValue(new ObjectId()),
}));
vi.mock("@/lib/electionEngine", () => ({
  fetchEnrichedCandidates: vi.fn(),
  initElectionVoteTally: vi.fn(),
  accumulateVoteTurn: vi.fn(),
}));
vi.mock("@/lib/presidentialElectionEngine", () => ({
  initPresidentVoteTally: vi.fn(),
  accumulatePresidentVoteTurn: vi.fn(),
}));
vi.mock("@/lib/primaryScore", () => ({
  calcPrimaryScore: vi.fn().mockReturnValue(50),
  calcPresidentPrimaryScore: vi.fn(),
  primarySharePctSoftmax: (scores: number[]) =>
    scores.map(() => (scores.length ? Math.round(10000 / scores.length) / 100 : 0)),
  buildPartyChairMaps: () => ({
    nationalChairIds: new Set<string>(),
    stateChairStatesByCharacterId: new Map<string, string[]>(),
  }),
  resolvePartyChairPrimaryRole: () => null,
  effectivePartyInfluenceForPresidentialPrimary: (v: number) => Math.max(0, v),
}));
vi.mock("@/lib/utils/getStateApprovalForElection", () => ({
  getAllStateApprovalsForElection: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/lib/utils/electionLabels", () => ({
  formatElectionTypeLabel: vi.fn().mockReturnValue("Senate"),
}));

const NOW = new Date("2025-06-15T12:00:00Z");

function makeCursor(docs: unknown[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    project: vi.fn().mockReturnThis(),
  };
}

function makeContestedElection(state: string) {
  const electionId = new ObjectId();
  const election = {
    _id: electionId,
    electionType: "senate",
    status: "active",
    countryId: "US",
    state,
    primaryEndTime: new Date(NOW.getTime() - 1000),
    endTime: new Date(NOW.getTime() + 100000),
  };
  const candidates = [0, 1].map((i) => ({
    _id: new ObjectId(),
    electionId,
    party: "DEM",
    characterName: `Candidate ${state} ${i}`,
    characterId: new ObjectId(),
    isNPP: false,
    status: "active",
  }));
  return { election, candidates };
}

describe("resolvePrimariesIfNeeded query batching", () => {
  let db: MockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("fetches characters in ONE batched $in query across all resolving elections", async () => {
    const a = makeContestedElection("CA");
    const b = makeContestedElection("NY");
    const allCandidates = [...a.candidates, ...b.candidates];

    db.collection("elections").find.mockReturnValue(makeCursor([a.election, b.election]));
    db.collection("politicalParties").find.mockReturnValue(makeCursor([]));
    db.collection("electionCandidates").find.mockImplementation((query?: unknown) => {
      const idFilter = (query as { _id?: { $in?: ObjectId[] } })?._id?.$in;
      if (idFilter) {
        const ids = idFilter.map((id) => id.toString());
        return makeCursor(allCandidates.filter((c) => ids.includes(c._id.toString())));
      }
      return makeCursor(allCandidates);
    });

    const { fetchEnrichedCandidates } = await import("@/lib/electionEngine");
    vi.mocked(fetchEnrichedCandidates).mockImplementation(
      async (cands: unknown[]) =>
        (cands as Array<{ _id: ObjectId }>).map((c, i) => ({
          candidateId: c._id.toString(),
          charEP: 0,
          charSP: 0,
          favorability: 50,
          politicalInfluence: 100 - i,
        })) as never
    );

    const characters = db.collection("characters");
    characters.find.mockImplementation((query?: unknown) => {
      const idFilter = (query as { _id?: { $in?: ObjectId[] } })?._id?.$in ?? [];
      const ids = new Set(idFilter.map((id: ObjectId) => id.toString()));
      return makeCursor(
        allCandidates
          .filter((c) => ids.has(c.characterId.toString()))
          .map((c) => ({ _id: c.characterId, userId: new ObjectId(), infamy: 0 }))
      );
    });
    const npps = db.collection("npps");

    const { resolvePrimariesIfNeeded } = await import("./primaryResolution");
    await resolvePrimariesIfNeeded(NOW, 100);

    // Non-vacuous: both primaries actually resolved (losers eliminated).
    const elimCalls = db.collectionMocks["electionCandidates"]!.updateMany.mock.calls;
    expect(elimCalls.length).toBeGreaterThan(0);

    // The load-bearing guard: ONE characters fetch total, covering every
    // resolving election's candidates — not one (or two) per election.
    expect(characters.find).toHaveBeenCalledTimes(1);
    const batched = (characters.find.mock.calls[0]?.[0] ?? {}) as {
      _id?: { $in?: ObjectId[] };
    };
    expect(batched._id?.$in).toHaveLength(4);

    // The npps map was dead (presidential scoring reads `enriched`); the fetch
    // must stay deleted.
    expect(npps.find).not.toHaveBeenCalled();
  });
});
