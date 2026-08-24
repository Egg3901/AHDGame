/**
 * Smoke tests for the slate-driven turn passes. Verifies the wiring of
 * `processSlateResponses` (resolver → DB write) and `fileAcceptedSlateRows`
 * (slate accept → ElectionCandidate insert + slate.filed transition).
 *
 * Pure-function coverage of the underlying resolver lives in
 * `slateResponse.test.ts`; this file exercises the integration glue.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  Election,
  ElectionCandidate,
  ElectedOfficial,
  NPP,
  NPPRelationship,
  RecruitmentSlate,
  SlateCandidate,
} from "@/lib/db/types";
import type { NPPContext } from "./context";
import { fileAcceptedSlateRows, processSlateResponses } from "./slateResponses";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

interface CollectionState {
  recruitmentSlates: RecruitmentSlate[];
  slateCandidates: SlateCandidate[];
  nppRelationships: NPPRelationship[];
  elections: Election[];
  electionCandidates: ElectionCandidate[];
}

function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "US_CA",
    party: "1",
    countryId: "US",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 50, ambition: 80, stubbornness: 50 },
    politicalInfluence: 10,
    favorability: 50,
    currentOffice: null,
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPP;
}

function buildDb(state: CollectionState): Db {
  const map: Record<string, unknown[]> = {
    recruitmentSlates: state.recruitmentSlates,
    slateCandidates: state.slateCandidates,
    nppRelationships: state.nppRelationships,
    elections: state.elections,
    electionCandidates: state.electionCandidates,
  };

  function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const key of Object.keys(filter)) {
      const want = filter[key];
      const have = doc[key];
      if (want && typeof want === "object" && "$in" in want) {
        const arr = (want as { $in: unknown[] }).$in;
        const found = arr.some((v) => sameId(have, v));
        if (!found) return false;
        continue;
      }
      if (want && typeof want === "object" && "$ne" in want) {
        if (sameId(have, (want as { $ne: unknown }).$ne)) return false;
        continue;
      }
      if (!sameId(have, want)) return false;
    }
    return true;
  }

  function sameId(a: unknown, b: unknown): boolean {
    if (a instanceof ObjectId && b instanceof ObjectId) return a.toString() === b.toString();
    return a === b;
  }

  return {
    collection(name: string) {
      const items = (map[name] ?? []) as Record<string, unknown>[];
      return {
        find: (filter: Record<string, unknown> = {}) => {
          const results = items.filter((d) => matches(d, filter));
          const cursor = {
            sort: () => cursor,
            project: () => cursor,
            toArray: async () => results,
          };
          // Allow a minimal limit; we don't need it for tests.
          return cursor;
        },
        findOne: async (filter: Record<string, unknown> = {}) => {
          return items.find((d) => matches(d, filter)) ?? null;
        },
        updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
          const target = items.find((d) => matches(d, filter));
          if (!target) return { modifiedCount: 0 };
          const set = (update.$set ?? {}) as Record<string, unknown>;
          for (const k of Object.keys(set)) target[k] = set[k];
          return { modifiedCount: 1 };
        },
        bulkWrite: async (
          ops: {
            updateOne?: { filter: Record<string, unknown>; update: Record<string, unknown> };
          }[]
        ) => {
          let modifiedCount = 0;
          for (const op of ops) {
            const updateOne = op.updateOne;
            if (updateOne) {
              const target = items.find((d) => matches(d, updateOne.filter));
              if (target) {
                const set = (updateOne.update.$set ?? {}) as Record<string, unknown>;
                for (const k of Object.keys(set)) target[k] = set[k];
                modifiedCount += 1;
              }
            }
          }
          return { modifiedCount, insertedCount: 0, deletedCount: 0 };
        },
        insertOne: async (doc: Record<string, unknown>) => {
          // Test hook: simulate the active-candidate partial unique index by
          // throwing a duplicate-key error for a sentinel candidate name.
          if (name === "electionCandidates" && doc.characterName === "DUPKEY_NPC") {
            throw Object.assign(
              new Error(
                "E11000 duplicate key error collection: app.electionCandidates index: unique_active_election_candidate_per_character"
              ),
              { code: 11000, keyPattern: { characterId: 1 } }
            );
          }
          if (!doc._id) doc._id = new ObjectId();
          items.push(doc);
          return { insertedId: doc._id };
        },
      } as unknown as ReturnType<Db["collection"]>;
    },
  } as unknown as Db;
}

function makeCtx(db: Db, npps: NPP[], overrides: Partial<NPPContext> = {}): NPPContext {
  return {
    db,
    now: new Date("2026-04-27T12:00:00Z"),
    allNPPs: npps,
    nppMap: new Map(npps.map((n) => [n._id.toString(), n])),
    openPrimaries: [],
    nppCandidacies: new Set(),
    candidatesByElection: new Map(),
    nppOfficials: [],
    officialsByNPP: new Map(),
    activeBills: [],
    billWhips: new Map(),
    activeStateBills: [],
    stateBillWhips: new Map(),
    speakerElection: null,
    speakerNominations: [],
    houseLeadershipElections: [],
    houseLeadershipNominations: [],
    senateLeadershipElections: [],
    senateLeadershipNominations: [],
    leadershipWhips: [],
    statePartyOrgs: new Map(),
    partyByCompositeKey: new Map(),
    partyCountries: new Map(),
    legislationTypeMap: new Map(),
    stateDemographicsMap: new Map(),
    statesById: new Map(),
    currentTurn: 0,
    ...overrides,
  };
}

describe("processSlateResponses", () => {
  it("flips invited rows to accepted/declined per the resolver", async () => {
    const npp = makeNPP();
    const slateId = new ObjectId();
    const electionId = new ObjectId();
    const chairId = new ObjectId();

    const slate: RecruitmentSlate = {
      _id: slateId,
      countryId: "US",
      partyId: "1",
      electionId,
      state: "US_CA",
      electionType: "house",
      priority: "high",
      archivedAt: null,
      createdBy: chairId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "invited",
      fitScore: 0,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: null,
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const relationship: NPPRelationship = {
      _id: `${chairId.toString()}_${npp._id.toString()}`,
      characterId: chairId,
      nppId: npp._id,
      relationshipScore: 80,
      totalAttempts: 0,
      successfulAttempts: 0,
      lastAttemptTurn: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [slate],
      slateCandidates: [candidateRow],
      nppRelationships: [relationship],
      elections: [],
      electionCandidates: [],
    });

    const summary = await processSlateResponses(makeCtx(db, [npp]));
    expect(summary.rowsConsidered).toBe(1);
    expect(summary.accepted).toBe(1);
    expect(candidateRow.status).toBe("accepted");
    expect(candidateRow.respondedAt).toBeInstanceOf(Date);
    expect(candidateRow.refusalReason).toBeNull();
  });

  it("re-resolves a legacy 'considering' row to accepted for a compliant NPP", async () => {
    const npp = makeNPP({ personality: { loyalty: 60, ambition: 50, stubbornness: 40 } });
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const slate: RecruitmentSlate = {
      _id: slateId,
      countryId: "US",
      partyId: "1",
      electionId,
      state: "US_CA",
      electionType: "house",
      priority: "none",
      archivedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "considering",
      fitScore: 50,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [slate],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [],
      electionCandidates: [],
    });

    const summary = await processSlateResponses(makeCtx(db, [npp]));
    expect(summary.accepted).toBe(1);
    expect(candidateRow.status).toBe("accepted");
    expect(candidateRow.refusalReason).toBeNull();
  });

  it("declines retired NPPs without consulting the relationship lookup", async () => {
    const npp = makeNPP({ retiredAt: new Date() });
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const slate: RecruitmentSlate = {
      _id: slateId,
      countryId: "US",
      partyId: "1",
      electionId,
      state: "US_CA",
      electionType: "house",
      priority: "high",
      archivedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "invited",
      fitScore: 0,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: null,
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [slate],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [],
      electionCandidates: [],
    });

    const summary = await processSlateResponses(makeCtx(db, [npp]));
    expect(summary.declined).toBe(1);
    expect(candidateRow.status).toBe("declined");
    expect(candidateRow.refusalReason).toBe("retired");
  });

  it("accepts a strong slate reassignment even when the NPP is already filed elsewhere", async () => {
    const npp = makeNPP();
    const slateId = new ObjectId();
    const electionId = new ObjectId();
    const chairId = new ObjectId();

    const slate: RecruitmentSlate = {
      _id: slateId,
      countryId: "US",
      partyId: "1",
      electionId,
      state: "US_CA",
      electionType: "house",
      priority: "high",
      archivedAt: null,
      createdBy: chairId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "invited",
      fitScore: 0,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: null,
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const relationship: NPPRelationship = {
      _id: `${chairId.toString()}_${npp._id.toString()}`,
      characterId: chairId,
      nppId: npp._id,
      relationshipScore: 80,
      totalAttempts: 0,
      successfulAttempts: 0,
      lastAttemptTurn: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [slate],
      slateCandidates: [candidateRow],
      nppRelationships: [relationship],
      elections: [],
      electionCandidates: [],
    });

    const summary = await processSlateResponses(
      makeCtx(db, [npp], {
        nppCandidacies: new Set([npp._id.toString()]),
      })
    );

    expect(summary.rowsConsidered).toBe(1);
    expect(summary.accepted).toBe(1);
    expect(candidateRow.status).toBe("accepted");
    expect(candidateRow.refusalReason).toBeNull();
  });
});

describe("fileAcceptedSlateRows", () => {
  it("inserts an ElectionCandidate for accepted rows and stamps filed", async () => {
    const npp = makeNPP();
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const election: Election = {
      _id: electionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(makeCtx(db, [npp]));
    expect(summary.filed).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].electionId).toEqual(electionId);
    expect(inserted[0].nppId).toEqual(npp._id);
    expect(candidateRow.status).toBe("filed");
    expect(candidateRow.filedAt).toBeInstanceOf(Date);
  });

  it("skips filing a banned-party NPP in an RU one-party-state race", async () => {
    const npp = makeNPP({
      countryId: "RU",
      homeState: "KAZ",
      party: "2",
    });
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const election: Election = {
      _id: electionId,
      countryId: "RU",
      electionType: "republicSupremeSoviet",
      state: "KAZ",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "2",
      countryId: "RU",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const partyByCompositeKey = new Map([
      [
        "RU:2",
        {
          sequentialId: 2,
          countryId: "RU",
          regimeStatus: "banned" as const,
          abbreviation: "MSPSU",
        } as never,
      ],
    ]);
    const summary = await fileAcceptedSlateRows(makeCtx(db, [npp], { partyByCompositeKey }));
    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(candidateRow.status).toBe("withdrawn");
  });

  it("skips rows for elections that are no longer accepting candidates without clearing the slate assignment", async () => {
    const npp = makeNPP();
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const election: Election = {
      _id: electionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      cycle: 1,
      status: "completed",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(makeCtx(db, [npp]));
    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(candidateRow.status).toBe("accepted");
  });

  it("skips an accepted row when the primary has closed even though the election is still active (general phase)", async () => {
    const npp = makeNPP();
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    // General phase: status is still "active" (it only flips to completed when
    // the GENERAL election resolves), but the primary boundary has passed.
    const election: Election = {
      _id: electionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      cycle: 1,
      status: "active",
      primaryEndTurn: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    // currentTurn 10 is past the primary close at turn 5.
    const summary = await fileAcceptedSlateRows(makeCtx(db, [npp], { currentTurn: 10 }));
    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
    // Slate assignment is preserved for template carryover (mirrors the
    // closed-election branch) — the row is NOT withdrawn.
    expect(candidateRow.status).toBe("accepted");
  });

  it("withdraws accepted rows when the target NPP retired before filing", async () => {
    const retiredNpp = makeNPP({ retiredAt: new Date() });
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const election: Election = {
      _id: electionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: retiredNpp._id,
      candidateName: retiredNpp.name,
      homeState: retiredNpp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(makeCtx(db, [retiredNpp]));
    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(inserted).toHaveLength(0);
    expect(candidateRow.status).toBe("withdrawn");
  });

  it("withdraws an NPP from their old race before filing the newly assigned slate race", async () => {
    const npp = makeNPP();
    const slateId = new ObjectId();
    const oldElectionId = new ObjectId();
    const newElectionId = new ObjectId();

    const newElection: Election = {
      _id: newElectionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId: newElectionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const oldCandidate: ElectionCandidate = {
      _id: new ObjectId(),
      electionId: oldElectionId,
      characterId: npp._id,
      characterName: npp.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: npp._id,
      enteredAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [oldCandidate];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [newElection],
      electionCandidates: inserted,
    });

    const candidatesByElection = new Map<string, ElectionCandidate[]>([
      [oldElectionId.toString(), [oldCandidate]],
    ]);
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [npp], {
        candidatesByElection,
        nppCandidacies: new Set([npp._id.toString()]),
      })
    );

    expect(summary.filed).toBe(1);
    expect(inserted).toHaveLength(2);
    expect(inserted[0].status).toBe("withdrawn");
    expect(inserted[0].withdrawnAt).toBeInstanceOf(Date);
    expect(inserted[1].electionId).toEqual(newElectionId);
    expect(candidateRow.status).toBe("filed");
    expect(candidatesByElection.get(oldElectionId.toString())?.[0].status).toBe("withdrawn");
  });

  it("adds the manual slate choice alongside a defending same-party incumbent", async () => {
    const incumbentNpp = makeNPP({ name: "Gregory Shah" });
    const slateNpp = makeNPP({ name: "Anthony Lewis" });
    const slateId = new ObjectId();
    const electionId = new ObjectId();

    const election: Election = {
      _id: electionId,
      countryId: "US",
      electionType: "governor",
      state: "US_CA",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId,
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: slateNpp._id,
      candidateName: slateNpp.name,
      homeState: slateNpp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const incumbentCandidate: ElectionCandidate = {
      _id: new ObjectId(),
      electionId,
      characterId: incumbentNpp._id,
      characterName: incumbentNpp.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: incumbentNpp._id,
      enteredAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [incumbentCandidate];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const candidatesByElection = new Map<string, ElectionCandidate[]>([
      [electionId.toString(), [incumbentCandidate]],
    ]);
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [incumbentNpp, slateNpp], {
        candidatesByElection,
        nppCandidacies: new Set([incumbentNpp._id.toString()]),
        officialsByNPP: new Map<string, ElectedOfficial[]>([
          [
            incumbentNpp._id.toString(),
            [
              {
                _id: new ObjectId(),
                officeType: "governor",
                state: election.state,
                characterId: incumbentNpp._id,
                characterName: incumbentNpp.name,
                party: incumbentNpp.party,
                isNPP: true,
                nppId: incumbentNpp._id,
                createdAt: new Date(),
                updatedAt: new Date(),
              } as ElectedOfficial,
            ],
          ],
        ]),
      })
    );

    expect(summary.filed).toBe(1);
    expect(inserted).toHaveLength(2);
    expect(inserted[0].status).toBe("active");
    expect(inserted[1].characterId).toEqual(slateNpp._id);
    expect(candidateRow.status).toBe("filed");
    expect(candidatesByElection.get(electionId.toString())).toHaveLength(2);
  });

  it("does not add a second same-party slate challenger when one is already active", async () => {
    const electionId = new ObjectId();
    const election: Election = {
      _id: electionId,
      electionType: "house",
      state: "US_CA",
      countryId: "US",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const activeChallenger = makeNPP({ name: "Active Slate Challenger" });
    const anotherChallenger = makeNPP({ name: "Another Slate Challenger" });

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: anotherChallenger._id,
      candidateName: anotherChallenger.name,
      homeState: anotherChallenger.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const challengerCandidate: ElectionCandidate = {
      _id: new ObjectId(),
      electionId,
      characterId: activeChallenger._id,
      characterName: activeChallenger.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: activeChallenger._id,
      enteredAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [challengerCandidate];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const candidatesByElection = new Map<string, ElectionCandidate[]>([
      [electionId.toString(), [challengerCandidate]],
    ]);
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [activeChallenger, anotherChallenger], {
        candidatesByElection,
        nppCandidacies: new Set([activeChallenger._id.toString()]),
      })
    );

    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(candidateRow.status).toBe("withdrawn");
    expect(candidatesByElection.get(electionId.toString())).toHaveLength(1);
  });

  it("keeps the NPP's existing candidacy when the slate row is skipped for slot capacity (ticket #1181)", async () => {
    // Chair moves an NPP into a race whose challenger slot is already taken.
    // The row is skipped, but the NPP must NOT be pulled out of the race they
    // currently hold — previously the move ran before the capacity check,
    // leaving them running nowhere.
    const electionId = new ObjectId();
    const oldElectionId = new ObjectId();
    const election: Election = {
      _id: electionId,
      electionType: "house",
      state: "US_CA",
      countryId: "US",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const slatedNpp = makeNPP({ name: "Slated Challenger" });
    const activeChallenger = makeNPP({ name: "Active Slate Challenger" });

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: slatedNpp._id,
      candidateName: slatedNpp.name,
      homeState: slatedNpp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const heldCandidacy: ElectionCandidate = {
      _id: new ObjectId(),
      electionId: oldElectionId,
      characterId: slatedNpp._id,
      characterName: slatedNpp.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: slatedNpp._id,
      enteredAt: new Date(),
    };

    const slotChallenger: ElectionCandidate = {
      _id: new ObjectId(),
      electionId,
      characterId: activeChallenger._id,
      characterName: activeChallenger.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: activeChallenger._id,
      enteredAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [heldCandidacy, slotChallenger];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const candidatesByElection = new Map<string, ElectionCandidate[]>([
      [electionId.toString(), [slotChallenger]],
      [oldElectionId.toString(), [heldCandidacy]],
    ]);
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [slatedNpp, activeChallenger], {
        candidatesByElection,
        nppCandidacies: new Set([slatedNpp._id.toString(), activeChallenger._id.toString()]),
      })
    );

    // Row still terminates as withdrawn (capacity rule), but the NPP's live
    // candidacy elsewhere is untouched.
    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(inserted).toHaveLength(2);
    expect(heldCandidacy.status).toBe("active");
    expect(candidatesByElection.get(oldElectionId.toString())?.[0].status).toBe("active");
  });

  it("isolates a row whose insert throws so the rest of the pass still files", async () => {
    const poisonNpp = makeNPP({ name: "DUPKEY_NPC" });
    const goodNpp = makeNPP({ name: "Files Fine" });
    const poisonElectionId = new ObjectId();
    const goodElectionId = new ObjectId();

    const baseElection = (id: ObjectId): Election =>
      ({
        _id: id,
        countryId: "US",
        electionType: "house",
        state: "US_CA",
        cycle: 1,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      }) as Election;

    const mkRow = (npp: NPP, electionId: ObjectId, updatedAt: Date): SlateCandidate => ({
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId,
      partyId: "1",
      countryId: "US",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 90,
      refusalReason: null,
      autoFilled: false,
      invitedAt: new Date(),
      respondedAt: new Date(),
      filedAt: null,
      createdAt: new Date(),
      updatedAt,
    });

    // Poison row sorts first (newer updatedAt); its insert throws E11000.
    const poisonRow = mkRow(poisonNpp, poisonElectionId, new Date("2026-04-27T12:00:00Z"));
    const goodRow = mkRow(goodNpp, goodElectionId, new Date("2026-04-27T11:00:00Z"));

    const inserted: ElectionCandidate[] = [];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [poisonRow, goodRow],
      nppRelationships: [],
      elections: [baseElection(poisonElectionId), baseElection(goodElectionId)],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(makeCtx(db, [poisonNpp, goodNpp]));

    // The good row still files even though the poison row's insert threw.
    expect(summary.filed).toBe(1);
    expect(goodRow.status).toBe("filed");
    expect(poisonRow.status).toBe("accepted"); // left for retry, not crashed
    expect(inserted.map((c) => c.characterName)).toContain("Files Fine");
  });
});
