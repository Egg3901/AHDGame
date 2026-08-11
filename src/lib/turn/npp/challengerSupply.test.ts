/**
 * Unit tests for processChallengerGeneration — the direct candidate-supply
 * floor that files bench candidates into primaries that would otherwise resolve
 * uncontested (single-seat governor/senate) or EMPTY (CN one-party People's
 * Congress, #3388).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Election, NPP, PoliticalParty, StatePartyOrg } from "@/lib/db/types";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processChallengerGeneration } from "./challengerSupply";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// createNPP is only hit when no free NPP exists in a bucket; stub it so the
// generate-fallback path is deterministic and DB-free.
vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn(
    async ({ state, party, countryId }: { state: string; party: string; countryId: string }) => ({
      _id: new ObjectId(),
      name: `Generated ${party}`,
      party,
      countryId,
      homeState: state,
    })
  ),
  calculateQualityBonus: vi.fn(() => 0),
}));

interface WorldFixture {
  currentTurn: number;
  elections: Election[];
  parties: PoliticalParty[];
  freeNpps: NPP[];
  officials: { nppId: ObjectId }[];
  statePartyOrgs: StatePartyOrg[];
  activeCandidateGroups?: { _id: { e: unknown; p: string }; nppIds: unknown[] }[];
}

function mountWorld(db: MockDb, w: WorldFixture) {
  const insertedCandidates: Record<string, unknown>[] = [];

  db.collection("gameState").findOne = vi.fn().mockResolvedValue({ currentTurn: w.currentTurn });

  db.collection("elections").find = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(w.elections) });

  db.collection("politicalParties").find = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(w.parties) });

  const ec = db.collection("electionCandidates");
  ec.aggregate = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(w.activeCandidateGroups ?? []) });
  ec.insertOne = vi.fn().mockImplementation((doc: Record<string, unknown>) => {
    insertedCandidates.push(doc);
    return Promise.resolve({ insertedId: new ObjectId() });
  });

  db.collection("electedOfficials").find = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(w.officials) });

  db.collection("npps").find = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(w.freeNpps) });

  db.collection("statePartyOrg").find = vi
    .fn()
    .mockReturnValue({ toArray: vi.fn().mockResolvedValue(w.statePartyOrgs) });

  return { insertedCandidates };
}

function cnPeoplesCongress(state: string): Election {
  return {
    _id: new ObjectId(),
    electionType: "peoplesCongress",
    state,
    countryId: "CN",
    cycle: 1,
    status: "active",
    totalSeats: 400,
    primaryEndTurn: 120,
    endTurn: 144,
    startTurn: 1,
  } as unknown as Election;
}

function cnParty(sequentialId: number, regimeStatus: string): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId,
    countryId: "CN",
    isDefault: true,
    regimeStatus,
  } as unknown as PoliticalParty;
}

function spo(state: string, partyId: string): StatePartyOrg {
  return {
    stateId: state,
    partyId,
    hasPresence: true,
    organization: 90,
  } as unknown as StatePartyOrg;
}

describe("processChallengerGeneration — CN one-party People's Congress floor (#3388)", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("files ruling/approved-party floor candidates so an empty CN peoplesCongress primary resolves with candidates", async () => {
    const election = cnPeoplesCongress("DB");
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 3,
      elections: [election],
      parties: [cnParty(1, "ruling"), cnParty(2, "approved")],
      freeNpps: [], // force the generate-fallback path
      officials: [],
      statePartyOrgs: [spo("DB", "1"), spo("DB", "2")],
    });

    const filed = await processChallengerGeneration(new Date());

    // Both default CN parties (CCP + CDL) get a candidate → chamber is no longer empty.
    expect(filed).toBe(2);
    expect(insertedCandidates).toHaveLength(2);
    for (const doc of insertedCandidates) {
      expect(doc.electionId).toStrictEqual(election._id);
      expect(doc.countryId).toBe("CN");
      expect(doc.status).toBe("active");
      expect(doc.isNPP).toBe(true);
    }
    expect(new Set(insertedCandidates.map((d) => d.party))).toStrictEqual(new Set(["1", "2"]));
  });

  it("does not double-file a party that already has an active candidate in the CN peoplesCongress primary", async () => {
    const election = cnPeoplesCongress("DB");
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 3,
      elections: [election],
      parties: [cnParty(1, "ruling"), cnParty(2, "approved")],
      freeNpps: [],
      officials: [],
      statePartyOrgs: [spo("DB", "1"), spo("DB", "2")],
      // CCP (party "1") already contesting this election.
      activeCandidateGroups: [{ _id: { e: election._id, p: "1" }, nppIds: [new ObjectId()] }],
    });

    const filed = await processChallengerGeneration(new Date());

    // Only the missing approved party (CDL, "2") gets floored.
    expect(filed).toBe(1);
    expect(insertedCandidates.map((d) => d.party)).toStrictEqual(["2"]);
  });

  it("skips a CN peoplesCongress primary whose primary window has already closed", async () => {
    const election = { ...cnPeoplesCongress("DB"), primaryEndTurn: 2 } as Election;
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 3, // past the primary window
      elections: [election],
      parties: [cnParty(1, "ruling"), cnParty(2, "approved")],
      freeNpps: [],
      officials: [],
      statePartyOrgs: [spo("DB", "1"), spo("DB", "2")],
    });

    // The query filters primaryEndTurn > currentTurn; a mounted-but-closed
    // election is not returned by the real query, so simulate that by returning
    // no open primaries.
    db.collection("elections").find = vi
      .fn()
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });

    const filed = await processChallengerGeneration(new Date());
    expect(filed).toBe(0);
    expect(insertedCandidates).toHaveLength(0);
  });
});
