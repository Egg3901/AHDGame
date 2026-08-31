import { describe, expect, it } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Character, Election, NPP, RecruitmentSlate, SlateCandidate } from "@/lib/db/types";
import {
  isSlateRowVisibleToChair,
  listStateAssignedCandidateIds,
  materializeSlateAssignmentsFromTemplate,
} from "./recruitmentSlateLookup";

interface CollectionState {
  recruitmentSlates: RecruitmentSlate[];
  slateCandidates: SlateCandidate[];
  elections: Election[];
  npps: NPP[];
  characters: Character[];
}

function sameId(a: unknown, b: unknown): boolean {
  if (a instanceof ObjectId && b instanceof ObjectId) return a.toString() === b.toString();
  return a === b;
}

function matches(doc: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, want] of Object.entries(filter)) {
    const have = doc[key];
    if (want && typeof want === "object" && "$in" in want) {
      if (!(want as { $in: unknown[] }).$in.some((value) => sameId(have, value))) return false;
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

function buildDb(state: CollectionState): Db {
  const collections: Record<string, Record<string, unknown>[]> = {
    recruitmentSlates: state.recruitmentSlates as unknown as Record<string, unknown>[],
    slateCandidates: state.slateCandidates as unknown as Record<string, unknown>[],
    elections: state.elections as unknown as Record<string, unknown>[],
    npps: state.npps as unknown as Record<string, unknown>[],
    characters: state.characters as unknown as Record<string, unknown>[],
  };

  return {
    collection(name: string) {
      const items = collections[name] ?? [];
      return {
        find: (filter: Record<string, unknown> = {}) => {
          const results = items.filter((item) => matches(item, filter));
          const cursor = {
            sort: () => cursor,
            project: () => cursor,
            toArray: async () => results,
          };
          return cursor;
        },
        findOne: async (filter: Record<string, unknown> = {}) =>
          items.find((item) => matches(item, filter)) ?? null,
        countDocuments: async (filter: Record<string, unknown> = {}) =>
          items.filter((item) => matches(item, filter)).length,
        insertOne: async (doc: Record<string, unknown>) => {
          items.push(doc);
          return { insertedId: doc._id };
        },
        insertMany: async (docs: Record<string, unknown>[]) => {
          for (const doc of docs) items.push(doc);
          return { insertedCount: docs.length };
        },
      } as unknown as ReturnType<Db["collection"]>;
    },
  } as unknown as Db;
}

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Assigned NPP",
    homeState: "US_CA",
    party: "1",
    countryId: "US",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 75, ambition: 60, stubbornness: 30 },
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

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    _id: new ObjectId(),
    userId: new ObjectId(),
    name: "Assigned Player",
    homeState: "US_CA",
    party: "1",
    countryId: "US",
    isNPP: false,
    donorBaseLevel: 0,
    policies: { economic: 0, social: 0 },
    currentOffice: null,
    actions: 0,
    funds: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Character;
}

describe("materializeSlateAssignmentsFromTemplate", () => {
  it("carries prior-cycle player and compliant NPP assignments into a newly opened race", async () => {
    const currentElectionId = new ObjectId();
    const previousElectionId = new ObjectId();
    const chairId = new ObjectId();
    const player = makeCharacter();
    const npp = makeNpp();

    const previousSlate: RecruitmentSlate = {
      _id: new ObjectId(),
      countryId: "US",
      partyId: "1",
      electionId: previousElectionId,
      state: "US_CA",
      electionType: "house",
      priority: "high",
      archivedAt: new Date(),
      createdBy: chairId,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };

    const previousRows: SlateCandidate[] = [
      {
        _id: new ObjectId(),
        slateId: previousSlate._id,
        electionId: previousElectionId,
        partyId: "1",
        countryId: "US",
        candidateType: "character",
        candidateId: player._id,
        candidateName: player.name,
        homeState: player.homeState,
        assignedByCharacterId: chairId,
        assignedByCharacterName: "Chair",
        status: "accepted",
        fitScore: 100,
        invitationNote: "Run again",
        refusalReason: null,
        autoFilled: false,
        invitedAt: new Date(),
        respondedAt: new Date(),
        filedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        _id: new ObjectId(),
        slateId: previousSlate._id,
        electionId: previousElectionId,
        partyId: "1",
        countryId: "US",
        candidateType: "npp",
        candidateId: npp._id,
        candidateName: npp.name,
        homeState: npp.homeState,
        assignedByCharacterId: chairId,
        assignedByCharacterName: "Chair",
        assignedByRole: "state_chair",
        status: "filed",
        fitScore: 80,
        invitationNote: "Defend seat",
        refusalReason: null,
        autoFilled: false,
        invitedAt: new Date(),
        respondedAt: new Date(),
        filedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const currentElection: Election = {
      _id: currentElectionId,
      countryId: "US",
      electionType: "house",
      state: "US_CA",
      cycle: 2,
      status: "active",
      primaryEndTime: new Date("2026-04-30T00:00:00Z"),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Election;

    const db = buildDb({
      recruitmentSlates: [previousSlate],
      slateCandidates: [...previousRows],
      elections: [
        {
          _id: previousElectionId,
          countryId: "US",
          electionType: "house",
          state: "US_CA",
          cycle: 1,
          status: "resolved",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
        currentElection,
      ],
      npps: [npp],
      characters: [player],
    });

    const slate = await materializeSlateAssignmentsFromTemplate({
      db,
      countryId: "US",
      partyId: "1",
      election: currentElection,
      now: new Date("2026-04-27T12:00:00Z"),
    });

    expect(slate).not.toBeNull();
    const clonedRows = (await (db.collection("slateCandidates") as ReturnType<Db["collection"]>)
      .find({
        electionId: currentElectionId,
      })
      .toArray()) as SlateCandidate[];
    expect(clonedRows).toHaveLength(2);
    expect(clonedRows.find((row) => row.candidateType === "character")?.status).toBe("accepted");
    expect(clonedRows.find((row) => row.candidateType === "npp")?.status).toBe("invited");
    expect(clonedRows.find((row) => row.candidateType === "npp")?.respondedAt).toBeNull();

    // Carried-forward rows are automatic persistence: the human attribution is
    // dropped (the original chair may be gone — #0961's phantom "Jonah") and the
    // row is flagged autoFilled, but the role is preserved so the state-chair
    // compliance bonus the race was slated under still applies.
    for (const row of clonedRows) {
      expect(row.autoFilled).toBe(true);
      expect(row.assignedByCharacterId).toBeNull();
      expect(row.assignedByCharacterName).toBeNull();
    }
    expect(clonedRows.find((row) => row.candidateType === "npp")?.assignedByRole).toBe(
      "state_chair"
    );
  });

  it("keeps low-compliance NPP assignments on the board as pending likely declines", async () => {
    const previousElectionId = new ObjectId();
    const currentElectionId = new ObjectId();
    const lowComplianceNpp = makeNpp({
      personality: { loyalty: 25, ambition: 60, stubbornness: 85 },
    });

    const previousSlate: RecruitmentSlate = {
      _id: new ObjectId(),
      countryId: "US",
      partyId: "1",
      electionId: previousElectionId,
      state: "US_CA",
      electionType: "house",
      priority: "none",
      archivedAt: new Date(),
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [previousSlate],
      slateCandidates: [
        {
          _id: new ObjectId(),
          slateId: previousSlate._id,
          electionId: previousElectionId,
          partyId: "1",
          countryId: "US",
          candidateType: "npp",
          candidateId: lowComplianceNpp._id,
          candidateName: lowComplianceNpp.name,
          homeState: lowComplianceNpp.homeState,
          status: "accepted",
          fitScore: 60,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
      ],
      elections: [
        {
          _id: previousElectionId,
          countryId: "US",
          electionType: "house",
          state: "US_CA",
          cycle: 1,
          status: "resolved",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
        {
          _id: currentElectionId,
          countryId: "US",
          electionType: "house",
          state: "US_CA",
          cycle: 2,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
      ],
      npps: [lowComplianceNpp],
      characters: [],
    });

    await materializeSlateAssignmentsFromTemplate({
      db,
      countryId: "US",
      partyId: "1",
      election: {
        _id: currentElectionId,
        countryId: "US",
        electionType: "house",
        state: "US_CA",
        cycle: 2,
      } as Election,
      now: new Date("2026-04-27T12:00:00Z"),
    });

    const clonedRows = (await (db.collection("slateCandidates") as ReturnType<Db["collection"]>)
      .find({
        electionId: currentElectionId,
      })
      .toArray()) as SlateCandidate[];
    expect(clonedRows).toHaveLength(1);
    expect(clonedRows[0].status).toBe("invited");
    expect(clonedRows[0].refusalReason).toBe("low_compliance");
    expect(clonedRows[0].respondedAt).toBeNull();
  });

  it("does not carry senate-class slate assignments across different classes", async () => {
    const classOneElectionId = new ObjectId();
    const classThreeElectionId = new ObjectId();
    const player = makeCharacter({ homeState: "US_PA" });

    const classOneSlate: RecruitmentSlate = {
      _id: new ObjectId(),
      countryId: "US",
      partyId: "1",
      electionId: classOneElectionId,
      state: "US_PA",
      electionType: "senate",
      priority: "high",
      archivedAt: new Date(),
      createdBy: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };

    const db = buildDb({
      recruitmentSlates: [classOneSlate],
      slateCandidates: [
        {
          _id: new ObjectId(),
          slateId: classOneSlate._id,
          electionId: classOneElectionId,
          partyId: "1",
          countryId: "US",
          candidateType: "character",
          candidateId: player._id,
          candidateName: player.name,
          homeState: player.homeState,
          status: "accepted",
          fitScore: 100,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
      ],
      elections: [
        {
          _id: classOneElectionId,
          countryId: "US",
          electionType: "senate",
          state: "US_PA",
          senateClass: 1,
          cycle: 1,
          status: "resolved",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
        {
          _id: classThreeElectionId,
          countryId: "US",
          electionType: "senate",
          state: "US_PA",
          senateClass: 3,
          cycle: 2,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
      ],
      npps: [],
      characters: [player],
    });

    const slate = await materializeSlateAssignmentsFromTemplate({
      db,
      countryId: "US",
      partyId: "1",
      election: {
        _id: classThreeElectionId,
        countryId: "US",
        electionType: "senate",
        state: "US_PA",
        senateClass: 3,
        cycle: 2,
      } as Election,
      now: new Date("2026-04-27T12:00:00Z"),
    });

    expect(slate).toBeNull();
    const clonedRows = (await (db.collection("slateCandidates") as ReturnType<Db["collection"]>)
      .find({
        electionId: classThreeElectionId,
      })
      .toArray()) as SlateCandidate[];
    expect(clonedRows).toHaveLength(0);
  });
});

describe("listStateAssignedCandidateIds", () => {
  it("ignores candidates from slates whose election has resolved (bug #0573)", async () => {
    const liveElectionId = new ObjectId();
    const resolvedElectionId = new ObjectId();
    const liveCandidate = new ObjectId();
    const staleCandidate1 = new ObjectId();
    const staleCandidate2 = new ObjectId();

    const liveSlate: RecruitmentSlate = {
      _id: new ObjectId(),
      countryId: "UK",
      partyId: "1",
      electionId: liveElectionId,
      state: "SEE",
      electionType: "commons",
      priority: "none",
      archivedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const resolvedSlate: RecruitmentSlate = {
      _id: new ObjectId(),
      countryId: "UK",
      partyId: "1",
      electionId: resolvedElectionId,
      state: "SEE",
      electionType: "commons",
      priority: "none",
      archivedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [liveSlate, resolvedSlate],
      slateCandidates: [
        {
          _id: new ObjectId(),
          slateId: liveSlate._id,
          electionId: liveElectionId,
          partyId: "1",
          countryId: "UK",
          candidateType: "character",
          candidateId: liveCandidate,
          candidateName: "Tom Rhayader",
          homeState: "SEE",
          status: "accepted",
          fitScore: 100,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
        {
          _id: new ObjectId(),
          slateId: resolvedSlate._id,
          electionId: resolvedElectionId,
          partyId: "1",
          countryId: "UK",
          candidateType: "character",
          candidateId: staleCandidate1,
          candidateName: "William Davies-Griffiths",
          homeState: "SEE",
          status: "accepted",
          fitScore: 100,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
        {
          _id: new ObjectId(),
          slateId: resolvedSlate._id,
          electionId: resolvedElectionId,
          partyId: "1",
          countryId: "UK",
          candidateType: "npp",
          candidateId: staleCandidate2,
          candidateName: "Catherine Smith",
          homeState: "SEE",
          status: "accepted",
          fitScore: 80,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
      ],
      elections: [
        {
          _id: liveElectionId,
          countryId: "UK",
          electionType: "commons",
          state: "SEE",
          cycle: 5,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
        {
          _id: resolvedElectionId,
          countryId: "UK",
          electionType: "commons",
          state: "SEE",
          cycle: 4,
          status: "resolved",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
      ],
      npps: [],
      characters: [],
    });

    const ids = await listStateAssignedCandidateIds(db, {
      countryId: "UK",
      partyId: "1",
      state: "SEE",
    });

    expect(ids).toEqual([liveCandidate.toString()]);
    expect(ids).not.toContain(staleCandidate1.toString());
    expect(ids).not.toContain(staleCandidate2.toString());
  });

  it("excludes withdrawn rows even on live slates", async () => {
    const liveElectionId = new ObjectId();
    const filedCandidate = new ObjectId();
    const withdrawnCandidate = new ObjectId();

    const liveSlate: RecruitmentSlate = {
      _id: new ObjectId(),
      countryId: "UK",
      partyId: "1",
      electionId: liveElectionId,
      state: "SEE",
      electionType: "commons",
      priority: "none",
      archivedAt: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = buildDb({
      recruitmentSlates: [liveSlate],
      slateCandidates: [
        {
          _id: new ObjectId(),
          slateId: liveSlate._id,
          electionId: liveElectionId,
          partyId: "1",
          countryId: "UK",
          candidateType: "character",
          candidateId: filedCandidate,
          candidateName: "Filed Candidate",
          homeState: "SEE",
          status: "filed",
          fitScore: 100,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
        {
          _id: new ObjectId(),
          slateId: liveSlate._id,
          electionId: liveElectionId,
          partyId: "1",
          countryId: "UK",
          candidateType: "character",
          candidateId: withdrawnCandidate,
          candidateName: "Withdrawn Candidate",
          homeState: "SEE",
          status: "withdrawn",
          fitScore: 100,
          refusalReason: null,
          autoFilled: false,
          invitedAt: new Date(),
          respondedAt: new Date(),
          filedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as SlateCandidate,
      ],
      elections: [
        {
          _id: liveElectionId,
          countryId: "UK",
          electionType: "commons",
          state: "SEE",
          cycle: 5,
          status: "active",
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Election,
      ],
      npps: [],
      characters: [],
    });

    const ids = await listStateAssignedCandidateIds(db, {
      countryId: "UK",
      partyId: "1",
      state: "SEE",
    });

    expect(ids).toEqual([filedCandidate.toString()]);
    expect(ids).not.toContain(withdrawnCandidate.toString());
  });
});

describe("isSlateRowVisibleToChair", () => {
  it("shows live rows", () => {
    for (const status of ["invited", "considering", "accepted", "declined", "filed"] as const) {
      expect(isSlateRowVisibleToChair({ status, refusalReason: null })).toBe(true);
    }
  });

  it("hides a chair-issued tombstone, which carries no reason", () => {
    expect(isSlateRowVisibleToChair({ status: "withdrawn", refusalReason: null })).toBe(false);
  });

  it("shows a tombstone the turn's filing pass wrote a reason onto (#1181)", () => {
    expect(isSlateRowVisibleToChair({ status: "withdrawn", refusalReason: "slot_taken" })).toBe(
      true
    );
    expect(
      isSlateRowVisibleToChair({ status: "withdrawn", refusalReason: "ineligible_region" })
    ).toBe(true);
  });
});
