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
import { fileAcceptedSlateRows, processSlateResponses, trimOverCapSlates } from "./slateResponses";

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
    expect(candidateRow.refusalReason).toBe("npp_unavailable");
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
    // A defending incumbent is never displaced to make room for the slate.
    expect(summary.displaced).toBe(0);
    expect(inserted).toHaveLength(2);
    expect(inserted[0].status).toBe("active");
    expect(inserted[1].characterId).toEqual(slateNpp._id);
    expect(candidateRow.status).toBe("filed");
    expect(candidatesByElection.get(electionId.toString())).toHaveLength(2);
  });

  it("files the chair's pick beside an auto-picked challenger while the race has room", async () => {
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
    const ctx = makeCtx(db, [activeChallenger, anotherChallenger], {
      candidatesByElection,
      nppCandidacies: new Set([activeChallenger._id.toString()]),
    });
    const summary = await fileAcceptedSlateRows(ctx);

    // Two candidates is inside the cap, so nobody has to give way: the chair's
    // pick joins the auto-pick and the primary decides between them. The
    // chair-outranks-autopilot rule only bites once the race is full, which
    // the assignment-cap suite covers.
    expect(summary.filed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.displaced).toBe(0);
    expect(candidateRow.status).toBe("filed");
    expect(challengerCandidate.status).toBe("active");
    expect(ctx.nppCandidacies.has(activeChallenger._id.toString())).toBe(true);
    expect(inserted.filter((c) => c.status === "active")).toHaveLength(2);
    expect(inserted.map((c) => c.characterId)).toContainEqual(anotherChallenger._id);
  });

  it("marks the row filed when the NPP already holds a candidacy in the slated race", async () => {
    // Guards the degenerate double-candidacy state: a stale active row in
    // another race must not make the pass resolve the wrong candidacy and then
    // report the NPP's own seat as a taken slot.
    const npp = makeNPP({ name: "Already Seated" });
    const staleElectionId = new ObjectId();
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

    const candidateRow: SlateCandidate = {
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
      updatedAt: new Date(),
    };

    const staleCandidacy: ElectionCandidate = {
      _id: new ObjectId(),
      electionId: staleElectionId,
      characterId: npp._id,
      characterName: npp.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: npp._id,
      enteredAt: new Date(),
    };
    const seatedCandidacy: ElectionCandidate = {
      _id: new ObjectId(),
      electionId,
      characterId: npp._id,
      characterName: npp.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: npp._id,
      enteredAt: new Date(),
    };

    const inserted: ElectionCandidate[] = [staleCandidacy, seatedCandidacy];
    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [candidateRow],
      nppRelationships: [],
      elections: [election],
      electionCandidates: inserted,
    });

    const candidatesByElection = new Map<string, ElectionCandidate[]>([
      [electionId.toString(), [seatedCandidacy]],
    ]);
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [npp], {
        candidatesByElection,
        nppCandidacies: new Set([npp._id.toString()]),
      })
    );

    expect(summary.filed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.displaced).toBe(0);
    expect(candidateRow.status).toBe("filed");
    expect(seatedCandidacy.status).toBe("active");
    expect(inserted).toHaveLength(2);
  });

  it("files a formerly-regional party's NPP outside its historic home nation", async () => {
    const electionId = new ObjectId();
    const election: Election = {
      _id: electionId,
      electionType: "commons",
      state: "EMI",
      countryId: "UK",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const npp = makeNPP({ name: "Oliver Hall", countryId: "UK", homeState: "EMI", party: "4" });

    const candidateRow: SlateCandidate = {
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId,
      partyId: "4",
      countryId: "UK",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status: "accepted",
      fitScore: 64,
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

    // Plaid Cymru stands UK-wide, so an East Midlands seat files like any
    // other. The NPP is homed in EMI, so the home-state rule is satisfied too.
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [npp], {
        partyByCompositeKey: new Map([
          ["UK:4", { sequentialId: 4, abbreviation: "PC", countryId: "UK" }],
        ]) as NPPContext["partyByCompositeKey"],
      })
    );

    expect(summary.filed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(inserted).toHaveLength(1);
    expect(candidateRow.status).toBe("filed");
    expect(candidateRow.refusalReason).toBeNull();
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

describe("fileAcceptedSlateRows assignment cap", () => {
  const electionId = new ObjectId();

  function capElection(): Election {
    return {
      _id: electionId,
      electionType: "commons",
      state: "NEE",
      countryId: "UK",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;
  }

  function capRow(
    npp: NPP,
    status: SlateCandidate["status"],
    autoFilled = false,
    invitedAt = new Date("2026-04-01T00:00:00Z")
  ): SlateCandidate {
    return {
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId,
      partyId: "1",
      countryId: "UK",
      candidateType: "npp",
      candidateId: npp._id,
      candidateName: npp.name,
      homeState: npp.homeState,
      status,
      fitScore: 90,
      refusalReason: null,
      autoFilled,
      invitedAt,
      respondedAt: new Date(),
      filedAt: status === "filed" ? new Date() : null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SlateCandidate;
  }

  function capCandidacy(npp: NPP): ElectionCandidate {
    return {
      _id: new ObjectId(),
      electionId,
      characterId: npp._id,
      characterName: npp.name,
      party: "1",
      status: "active",
      isNPP: true,
      nppId: npp._id,
      enteredAt: new Date(),
    } as ElectionCandidate;
  }

  function ukNpp(name: string): NPP {
    return makeNPP({ name, homeState: "NEE", countryId: "UK", party: "1" });
  }

  it("files a second chair pick beside the first while the race has room", async () => {
    const first = ukNpp("Chair First Pick");
    const second = ukNpp("Chair Second Pick");
    const filedRow = capRow(first, "filed");
    const pendingRow = capRow(second, "accepted");
    const filedCandidate = capCandidacy(first);
    const inserted: ElectionCandidate[] = [filedCandidate];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [filedRow, pendingRow],
      nppRelationships: [],
      elections: [capElection()],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [first, second], {
        candidatesByElection: new Map([[electionId.toString(), [filedCandidate]]]),
        nppCandidacies: new Set([first._id.toString()]),
      })
    );

    expect(summary.filed).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(pendingRow.status).toBe("filed");
    expect(filedCandidate.status).toBe("active");
    expect(inserted.filter((c) => c.status === "active")).toHaveLength(2);
  });

  it("refuses a fourth candidate on the race and says the slate is full", async () => {
    const held = [ukNpp("Held One"), ukNpp("Held Two"), ukNpp("Held Three")];
    const fourth = ukNpp("One Too Many");
    const heldRows = held.map((npp) => capRow(npp, "filed"));
    const pendingRow = capRow(fourth, "accepted");
    const heldCandidacies = held.map(capCandidacy);
    const inserted: ElectionCandidate[] = [...heldCandidacies];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [...heldRows, pendingRow],
      nppRelationships: [],
      elections: [capElection()],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [...held, fourth], {
        candidatesByElection: new Map([[electionId.toString(), heldCandidacies]]),
        nppCandidacies: new Set(held.map((n) => n._id.toString())),
      })
    );

    expect(summary.filed).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(pendingRow.status).toBe("withdrawn");
    expect(pendingRow.refusalReason).toBe("slate_full");
    expect(inserted.filter((c) => c.status === "active")).toHaveLength(3);
  });

  it("counts an autopilot pick against the cap even though it has no slate row", async () => {
    const chairPicks = [ukNpp("Chair One"), ukNpp("Chair Two")];
    const autoPick = ukNpp("Autopilot Pick");
    const fourth = ukNpp("One Too Many");
    const chairRows = chairPicks.map((npp) => capRow(npp, "filed"));
    const pendingRow = capRow(fourth, "accepted");
    // The autopilot pick holds a candidacy and no slate row, and is an
    // incumbent, so the chair's row cannot displace it either.
    const autoCandidacy = capCandidacy(autoPick);
    const held = [...chairPicks.map(capCandidacy), autoCandidacy];
    const inserted: ElectionCandidate[] = [...held];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [...chairRows, pendingRow],
      nppRelationships: [],
      elections: [capElection()],
      electionCandidates: inserted,
    });

    const officialsByNPP = new Map([
      [autoPick._id.toString(), [{ officeType: "commons", state: "NEE" }]],
    ]);
    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [...chairPicks, autoPick, fourth], {
        candidatesByElection: new Map([[electionId.toString(), held]]),
        nppCandidacies: new Set(held.map((c) => c.characterId.toString())),
        officialsByNPP: officialsByNPP as never,
      })
    );

    expect(summary.filed).toBe(0);
    expect(pendingRow.refusalReason).toBe("slate_full");
  });

  it("displaces an autopilot pick when the race is full so the chair's pick still files", async () => {
    const chairPicks = [ukNpp("Chair One"), ukNpp("Chair Two")];
    const autoPick = ukNpp("Autopilot Pick");
    const wanted = ukNpp("Chair Three");
    const chairRows = chairPicks.map((npp) => capRow(npp, "filed"));
    const pendingRow = capRow(wanted, "accepted");
    const autoCandidacy = capCandidacy(autoPick);
    const held = [...chairPicks.map(capCandidacy), autoCandidacy];
    const inserted: ElectionCandidate[] = [...held];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [...chairRows, pendingRow],
      nppRelationships: [],
      elections: [capElection()],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [...chairPicks, autoPick, wanted], {
        candidatesByElection: new Map([[electionId.toString(), held]]),
        nppCandidacies: new Set(held.map((c) => c.characterId.toString())),
      })
    );

    // The autopilot pick is not an incumbent and holds no chair-issued row, so
    // it yields the last slot rather than the chair's instruction being lost.
    expect(summary.filed).toBe(1);
    expect(summary.displaced).toBe(1);
    expect(pendingRow.status).toBe("filed");
    expect(autoCandidacy.status).toBe("withdrawn");
    expect(inserted.filter((c) => c.status === "active")).toHaveLength(3);
  });

  it("gives a slot released earlier in the same pass to the next row", async () => {
    const seated = [ukNpp("Seated One"), ukNpp("Seated Two")];
    const retired = makeNPP({
      name: "Retired Pick",
      homeState: "NEE",
      countryId: "UK",
      party: "1",
      retiredAt: new Date("2026-02-01T00:00:00Z"),
    });
    const wanted = ukNpp("Should Still File");

    const seatedRows = seated.map((npp) => capRow(npp, "filed"));
    // Processed first (latest updatedAt) and invited first, so without the
    // release it would keep holding the third slot after being tombstoned.
    const retiredRow = {
      ...capRow(retired, "accepted", false, new Date("2026-03-01T00:00:00Z")),
      updatedAt: new Date("2026-04-10T00:00:00Z"),
    } as SlateCandidate;
    const wantedRow = {
      ...capRow(wanted, "accepted", false, new Date("2026-03-02T00:00:00Z")),
      updatedAt: new Date("2026-04-09T00:00:00Z"),
    } as SlateCandidate;

    const seatedCandidacies = seated.map(capCandidacy);
    const inserted: ElectionCandidate[] = [...seatedCandidacies];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [...seatedRows, retiredRow, wantedRow],
      nppRelationships: [],
      elections: [capElection()],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [...seated, retired, wanted], {
        candidatesByElection: new Map([[electionId.toString(), seatedCandidacies]]),
        nppCandidacies: new Set(seated.map((n) => n._id.toString())),
      })
    );

    expect(retiredRow.refusalReason).toBe("npp_unavailable");
    expect(summary.filed).toBe(1);
    expect(wantedRow.status).toBe("filed");
    expect(wantedRow.refusalReason).toBeNull();
  });

  it("counts a chair-assigned player against the same pool as NPPs", async () => {
    const chairNpps = [ukNpp("Chair One"), ukNpp("Chair Two")];
    const fourth = ukNpp("One Too Many");
    const playerId = new ObjectId();
    const playerRow: SlateCandidate = {
      ...capRow(chairNpps[0]!, "accepted"),
      _id: new ObjectId(),
      candidateType: "character",
      candidateId: playerId,
      candidateName: "Player Candidate",
    };
    const chairRows = chairNpps.map((npp) => capRow(npp, "filed"));
    const pendingRow = capRow(fourth, "accepted");
    const heldCandidacies = chairNpps.map(capCandidacy);
    const inserted: ElectionCandidate[] = [...heldCandidacies];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: [...chairRows, playerRow, pendingRow],
      nppRelationships: [],
      elections: [capElection()],
      electionCandidates: inserted,
    });

    const summary = await fileAcceptedSlateRows(
      makeCtx(db, [...chairNpps, fourth], {
        candidatesByElection: new Map([[electionId.toString(), heldCandidacies]]),
        nppCandidacies: new Set(chairNpps.map((n) => n._id.toString())),
      })
    );

    // Two NPPs plus the chair's player pick fill the race.
    expect(summary.filed).toBe(0);
    expect(pendingRow.refusalReason).toBe("slate_full");
  });
});

describe("trimOverCapSlates", () => {
  const electionId = new ObjectId();

  function trimElection(): Election {
    return {
      _id: electionId,
      electionType: "commons",
      state: "NEE",
      countryId: "UK",
      cycle: 1,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;
  }

  function trimNpp(name: string): NPP {
    return makeNPP({ name, homeState: "NEE", countryId: "UK", party: "1" });
  }

  function trimRow(
    candidateId: ObjectId,
    name: string,
    invitedAt: Date,
    candidateType: "npp" | "character" = "npp"
  ): SlateCandidate {
    return {
      _id: new ObjectId(),
      slateId: new ObjectId(),
      electionId,
      partyId: "1",
      countryId: "UK",
      candidateType,
      candidateId,
      candidateName: name,
      homeState: "NEE",
      status: "filed",
      fitScore: 80,
      refusalReason: null,
      autoFilled: false,
      invitedAt,
      respondedAt: new Date(),
      filedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as SlateCandidate;
  }

  function trimCandidacy(
    id: ObjectId,
    name: string,
    isNPP = true,
    enteredAt = new Date(Date.UTC(2026, 0, 1))
  ): ElectionCandidate {
    return {
      _id: new ObjectId(),
      electionId,
      characterId: id,
      characterName: name,
      party: "1",
      status: "active",
      isNPP,
      ...(isNPP ? { nppId: id } : {}),
      enteredAt,
    } as ElectionCandidate;
  }

  function day(n: number): Date {
    return new Date(Date.UTC(2026, 0, n));
  }

  it("leaves a race inside the cap untouched", async () => {
    const npps = [trimNpp("One"), trimNpp("Two"), trimNpp("Three")];
    const candidacies = npps.map((n) => trimCandidacy(n._id, n.name));
    const rows = npps.map((n, i) => trimRow(n._id, n.name, day(i + 1)));

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: rows,
      nppRelationships: [],
      elections: [trimElection()],
      electionCandidates: [...candidacies],
    });

    const summary = await trimOverCapSlates(
      makeCtx(db, npps, {
        openPrimaries: [trimElection()],
        candidatesByElection: new Map([[electionId.toString(), candidacies]]),
      })
    );

    expect(summary.withdrawn).toBe(0);
    expect(summary.partiesTrimmed).toBe(0);
    expect(candidacies.every((c) => c.status === "active")).toBe(true);
  });

  it("withdraws the lowest-ranked holder on a race that is over the cap", async () => {
    const npps = [trimNpp("One"), trimNpp("Two"), trimNpp("Three"), trimNpp("Four")];
    const candidacies = npps.map((n, i) => trimCandidacy(n._id, n.name, true, day(i + 1)));
    const rows = npps.map((n, i) => trimRow(n._id, n.name, day(i + 1)));

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: rows,
      nppRelationships: [],
      elections: [trimElection()],
      electionCandidates: [...candidacies],
    });

    const summary = await trimOverCapSlates(
      makeCtx(db, npps, {
        openPrimaries: [trimElection()],
        candidatesByElection: new Map([[electionId.toString(), candidacies]]),
        nppCandidacies: new Set(npps.map((n) => n._id.toString())),
      })
    );

    expect(summary.partiesTrimmed).toBe(1);
    expect(summary.withdrawn).toBe(1);
    // Newest invitation is the one that goes.
    expect(candidacies[3]!.status).toBe("withdrawn");
    expect(rows[3]!.status).toBe("withdrawn");
    expect(rows[3]!.refusalReason).toBe("slate_full");
    expect(candidacies.slice(0, 3).every((c) => c.status === "active")).toBe(true);
  });

  it("keeps a defending incumbent and trims a later holder instead", async () => {
    const incumbent = trimNpp("Sitting Member");
    const others = [trimNpp("One"), trimNpp("Two"), trimNpp("Three")];
    // The incumbent was invited last, so only office-holding can save them.
    const rows = [
      ...others.map((n, i) => trimRow(n._id, n.name, day(i + 1))),
      trimRow(incumbent._id, incumbent.name, day(9)),
    ];
    const candidacies = [
      ...others.map((n, i) => trimCandidacy(n._id, n.name, true, day(i + 1))),
      trimCandidacy(incumbent._id, incumbent.name, true, day(9)),
    ];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: rows,
      nppRelationships: [],
      elections: [trimElection()],
      electionCandidates: [...candidacies],
    });

    const summary = await trimOverCapSlates(
      makeCtx(db, [...others, incumbent], {
        openPrimaries: [trimElection()],
        candidatesByElection: new Map([[electionId.toString(), candidacies]]),
        officialsByNPP: new Map([
          [incumbent._id.toString(), [{ officeType: "commons", state: "NEE" }]],
        ]) as never,
      })
    );

    expect(summary.withdrawn).toBe(1);
    expect(candidacies[3]!.status).toBe("active"); // the incumbent
    expect(candidacies[2]!.status).toBe("withdrawn"); // last non-incumbent
  });

  it("leaves a race alone once its primary has closed", async () => {
    // The general ballot is settled. Withdrawing someone from it to satisfy a
    // cap would change a contest already under way.
    const npps = [trimNpp("One"), trimNpp("Two"), trimNpp("Three"), trimNpp("Four")];
    const candidacies = npps.map((n, i) => trimCandidacy(n._id, n.name, true, day(i + 1)));
    const rows = npps.map((n, i) => trimRow(n._id, n.name, day(i + 1)));
    const generalPhase = { ...trimElection(), primaryEndTurn: 5 } as Election;

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: rows,
      nppRelationships: [],
      elections: [generalPhase],
      electionCandidates: [...candidacies],
    });

    const summary = await trimOverCapSlates(
      makeCtx(db, npps, {
        currentTurn: 9,
        openPrimaries: [generalPhase],
        candidatesByElection: new Map([[electionId.toString(), candidacies]]),
      })
    );

    expect(summary.partiesTrimmed).toBe(0);
    expect(summary.withdrawn).toBe(0);
    expect(candidacies.every((c) => c.status === "active")).toBe(true);
  });

  it("tombstones an over-cap row that never reached the ballot", async () => {
    const seated = [trimNpp("One"), trimNpp("Two"), trimNpp("Three")];
    const waiting = trimNpp("Never Filed");
    const candidacies = seated.map((n, i) => trimCandidacy(n._id, n.name, true, day(i + 1)));
    const rows = [
      ...seated.map((n, i) => trimRow(n._id, n.name, day(i + 1))),
      { ...trimRow(waiting._id, waiting.name, day(9)), status: "accepted", filedAt: null },
    ] as SlateCandidate[];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: rows,
      nppRelationships: [],
      elections: [trimElection()],
      electionCandidates: [...candidacies],
    });

    const summary = await trimOverCapSlates(
      makeCtx(db, [...seated, waiting], {
        openPrimaries: [trimElection()],
        candidatesByElection: new Map([[electionId.toString(), candidacies]]),
      })
    );

    // Nothing to withdraw, since the row never became a candidacy.
    expect(summary.withdrawn).toBe(0);
    expect(summary.tombstoned).toBe(1);
    expect(rows[3]!.status).toBe("withdrawn");
    expect(rows[3]!.refusalReason).toBe("slate_full");
    expect(candidacies.every((c) => c.status === "active")).toBe(true);
  });

  it("never withdraws a player's own candidacy, trimming an NPP instead", async () => {
    const playerId = new ObjectId();
    const npps = [trimNpp("One"), trimNpp("Two"), trimNpp("Three")];
    const rows = [
      ...npps.map((n, i) => trimRow(n._id, n.name, day(i + 1))),
      trimRow(playerId, "Player Candidate", day(9), "character"),
    ];
    const candidacies = [
      ...npps.map((n, i) => trimCandidacy(n._id, n.name, true, day(i + 1))),
      trimCandidacy(playerId, "Player Candidate", false, day(9)),
    ];

    const db = buildDb({
      recruitmentSlates: [],
      slateCandidates: rows,
      nppRelationships: [],
      elections: [trimElection()],
      electionCandidates: [...candidacies],
    });

    const summary = await trimOverCapSlates(
      makeCtx(db, npps, {
        openPrimaries: [trimElection()],
        candidatesByElection: new Map([[electionId.toString(), candidacies]]),
      })
    );

    expect(summary.withdrawn).toBe(1);
    // The player keeps their place; the last NPP holder gives way.
    expect(candidacies[3]!.status).toBe("active");
    expect(candidacies[2]!.status).toBe("withdrawn");
  });
});
