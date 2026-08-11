import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ElectedOfficial, NPP, State, StateBill } from "@/lib/db/types";
import { processStateBillVoting } from "./stateBillVoting";
import type { NPPContext } from "./context";

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Local NPP",
    countryId: "US",
    homeState: "AZ",
    party: "1",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 80, ambition: 50, stubbornness: 20 },
    politicalInfluence: 10,
    favorability: 50,
    currentOffice: "stateSenate",
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPP;
}

function makeOfficial(nppId: ObjectId, overrides: Partial<ElectedOfficial> = {}): ElectedOfficial {
  return {
    _id: new ObjectId(),
    countryId: "US",
    officeType: "stateSenate",
    characterId: null,
    isNPP: true,
    nppId,
    state: "AZ",
    seatsHeld: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ElectedOfficial;
}

function makeStateBill(overrides: Partial<StateBill> = {}): StateBill {
  return {
    _id: new ObjectId(),
    stateId: "AZ",
    title: "Regional Measure",
    summary: "Test",
    sponsorId: null,
    sponsorName: "Sponsor",
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    proposedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as StateBill;
}

function makeMockDb() {
  const collections = {
    stateBills: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    nppVotePredictions: {
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    // processStateBillVoting also reads active governor addresses for the
    // agenda-bonus cross-pressure nudge. No addresses in tests; return [].
    governorAddresses: {
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    },
  };
  return {
    collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    collections,
  } as unknown as Db & { collections: typeof collections };
}

function makeCtx(
  db: Db,
  bill: StateBill,
  npp: NPP,
  official: ElectedOfficial,
  state: State
): NPPContext {
  return {
    db,
    now: new Date(),
    allNPPs: [npp],
    nppMap: new Map([[npp._id.toString(), npp]]),
    openPrimaries: [],
    nppCandidacies: new Set(),
    candidatesByElection: new Map(),
    nppOfficials: [official],
    officialsByNPP: new Map([[npp._id.toString(), [official]]]),
    activeBills: [],
    billWhips: new Map(),
    activeStateBills: [bill],
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
    statesById: new Map([[state._id, state]]),
    currentTurn: 42,
  };
}

describe("processStateBillVoting", () => {
  it("casts local NPP votes and persists state-bill prediction snapshots", async () => {
    const db = makeMockDb();
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const bill = makeStateBill();
    const state = { _id: "AZ", countryId: "US" } as State;

    const votesCast = await processStateBillVoting(makeCtx(db, bill, npp, official, state));

    expect(votesCast).toBe(1);
    expect(db.collections.stateBills.updateOne).toHaveBeenCalledWith(
      { _id: bill._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: expect.any(String),
        }),
      })
    );
    const [ops] = db.collections.nppVotePredictions.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: { stateBillId?: ObjectId } } }>,
    ];
    expect(ops[0]!.updateOne.filter.stateBillId).toEqual(bill._id);
  });

  it("forces abstentions to against during local override votes", async () => {
    const db = makeMockDb();
    const npp = makeNpp({
      donorBaseLevel: 0,
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      policies: { economic: 0, social: 0 },
    });
    const official = makeOfficial(npp._id);
    const bill = makeStateBill({
      status: "veto_override",
      overrideVotes: {},
      overrideVotesFor: 0,
      overrideVotesAgainst: 0,
    });
    const state = { _id: "AZ", countryId: "US" } as State;

    await processStateBillVoting(makeCtx(db, bill, npp, official, state));

    expect(db.collections.stateBills.updateOne).toHaveBeenCalledWith(
      { _id: bill._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`overrideVotes.npp_${npp._id.toString()}`]: "against",
        }),
      })
    );
  });
});
