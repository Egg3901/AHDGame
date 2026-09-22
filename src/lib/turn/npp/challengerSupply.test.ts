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
  founding?: boolean;
  elections: Election[];
  parties: PoliticalParty[];
  freeNpps: NPP[];
  officials: { nppId: ObjectId }[];
  statePartyOrgs: StatePartyOrg[];
  activeCandidateGroups?: { _id: { e: unknown; p: string }; nppIds: unknown[] }[];
}

function mountWorld(db: MockDb, w: WorldFixture) {
  const insertedCandidates: Record<string, unknown>[] = [];

  db.collection("gameState").findOne = vi.fn().mockResolvedValue({
    currentTurn: w.currentTurn,
    preIteration: { active: w.founding === true },
  });

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

function defaultParty(countryId: string, sequentialId: number): PoliticalParty {
  return {
    _id: new ObjectId(),
    sequentialId,
    countryId,
    isDefault: true,
  } as unknown as PoliticalParty;
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

describe("processChallengerGeneration — founding coverage (#2072)", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("files candidates in a cycle-0 presidential race", async () => {
    const election = {
      ...cnPeoplesCongress("US"),
      countryId: "US",
      state: "US",
      electionType: "president",
      cycle: 0,
    } as Election;
    const party = {
      ...cnParty(1, "ruling"),
      countryId: "US",
    } as PoliticalParty;
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 1,
      founding: true,
      elections: [election],
      parties: [party],
      freeNpps: [],
      officials: [],
      statePartyOrgs: [],
    });

    expect(await processChallengerGeneration(new Date())).toBe(1);
    expect(db.collection("elections").find).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active", cycle: 0 }),
      expect.anything()
    );
    expect(db.collection("elections").find.mock.calls[0]?.[0]).not.toHaveProperty("electionType");
    expect(insertedCandidates).toEqual([
      expect.objectContaining({ electionId: election._id, countryId: "US", party: "1" }),
    ]);
  });

  it("gives a wholly-empty founding race one fallback when org presence blocks every party", async () => {
    const election = { ...cnPeoplesCongress("DUB"), countryId: "IE", cycle: 0 } as Election;
    const party = { ...cnParty(1, "ruling"), countryId: "IE" } as PoliticalParty;
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 1,
      founding: true,
      elections: [election],
      parties: [party],
      freeNpps: [],
      officials: [],
      statePartyOrgs: [{ ...spo("DUB", "1"), hasPresence: false } as unknown as StatePartyOrg],
    });

    expect(await processChallengerGeneration(new Date())).toBe(1);
    expect(insertedCandidates).toHaveLength(1);
  });
});

describe("processChallengerGeneration: concurrent regional chamber floor (#2098)", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("covers overlapping Turkish chambers after the four-member Istanbul pool is exhausted", async () => {
    const assembly = {
      ...cnPeoplesCongress("TR_IST"),
      electionType: "milletMeclisi",
      countryId: "TR",
    } as Election;
    const senate = {
      ...cnPeoplesCongress("TR_IST"),
      _id: new ObjectId(),
      electionType: "senato",
      countryId: "TR",
    } as Election;
    const exhaustedRoster = Array.from({ length: 4 }, () => new ObjectId());
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 3,
      elections: [senate, assembly],
      parties: [defaultParty("TR", 1), defaultParty("TR", 2)],
      freeNpps: [],
      officials: exhaustedRoster.map((nppId) => ({ nppId })),
      statePartyOrgs: [spo("TR_IST", "1"), spo("TR_IST", "2")],
      activeCandidateGroups: exhaustedRoster.map((nppId, index) => ({
        _id: { e: senate._id, p: String((index % 2) + 1) },
        nppIds: [nppId],
      })),
    });

    const filed = await processChallengerGeneration(new Date());

    expect(filed).toBe(2);
    expect(insertedCandidates).toHaveLength(2);
    expect(insertedCandidates.map((candidate) => candidate.electionId)).toStrictEqual([
      assembly._id,
      assembly._id,
    ]);
    expect(new Set(insertedCandidates.map((candidate) => candidate.party))).toStrictEqual(
      new Set(["1", "2"])
    );
  });

  it("supplies both major parties to an empty US House race when every local NPP is busy", async () => {
    const house = {
      ...cnPeoplesCongress("VT"),
      electionType: "house",
      countryId: "US",
    } as Election;
    const { insertedCandidates } = mountWorld(db, {
      currentTurn: 3,
      elections: [house],
      parties: [defaultParty("US", 1), defaultParty("US", 2)],
      freeNpps: [],
      officials: [],
      statePartyOrgs: [spo("VT", "1"), spo("VT", "2")],
    });

    expect(await processChallengerGeneration(new Date())).toBe(2);
    expect(new Set(insertedCandidates.map((candidate) => candidate.party))).toStrictEqual(
      new Set(["1", "2"])
    );
  });
});

describe("processChallengerGeneration: 2027 qualification coverage (#2072)", () => {
  let db: MockDb;

  beforeEach(async () => {
    db = createMockDb();
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it.each([
    ["DE", "ministerPresident", "BY"],
    ["ES", "congresoDiputados", "ES_MAD"],
    ["ES", "senado", "ES_MAD"],
    ["FI", "eduskunta", "FI_HEL"],
    ["GR", "vouli", "GR_ATT"],
    ["IE", "dail", "DUB"],
    ["IE", "localCouncil", "DUB"],
    ["JP", "sangiin", "JP_TKY"],
    ["NG", "president", "NG"],
    ["NG", "governor", "NORTH_WEST"],
    ["NG", "senate", "NORTH_WEST"],
    ["NG", "regionalCouncil", "NORTH_WEST"],
  ])(
    "files a candidate into an empty active %s %s contest",
    async (countryId, electionType, state) => {
      const election = {
        ...cnPeoplesCongress(state),
        countryId,
        electionType,
      } as Election;
      const { insertedCandidates } = mountWorld(db, {
        currentTurn: 3,
        elections: [election],
        parties: [defaultParty(countryId, 1)],
        freeNpps: [],
        officials: [],
        statePartyOrgs: [spo(state, "1")],
      });
      db.collection("elections").find = vi
        .fn()
        .mockImplementation((filter: Record<string, unknown>) => {
          const coveredTypes = (filter.electionType as { $in?: string[] } | undefined)?.$in;
          return {
            toArray: vi
              .fn()
              .mockResolvedValue(coveredTypes?.includes(electionType) ? [election] : []),
          };
        });

      expect(await processChallengerGeneration(new Date())).toBe(1);
      expect(insertedCandidates).toEqual([
        expect.objectContaining({ electionId: election._id, countryId, party: "1" }),
      ]);
    }
  );
});
