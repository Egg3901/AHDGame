import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type {
  Bill,
  CabinetNomination,
  ElectedOfficial,
  NPP,
  SpeakerNomination,
  StateBill,
} from "@/lib/db/types";

function makeCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
  };
}

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Fallback NPP",
    countryId: "US",
    homeState: "US_CA",
    party: "1",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 0, ambition: 50, stubbornness: 100 },
    politicalInfluence: 10,
    favorability: 50,
    currentOffice: { type: "house", state: "US_CA", seatsHeld: 1 },
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
    officeType: "house",
    characterId: null,
    isNPP: true,
    nppId,
    seatsHeld: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ElectedOfficial;
}

function createCollectionMap() {
  return {
    bills: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    stateBills: {
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    nppVotePredictions: {
      bulkWrite: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    speakerNominations: {
      find: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    noConfidenceVotes: {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    governmentFormations: {
      findOne: vi.fn(),
    },
    cabinetNominations: {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
  };
}

describe("applyWhipVotes fallback handling", () => {
  it("casts a deterministic fallback leadership vote for low-compliance NPPs on a soft whip", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const targetNomination: SpeakerNomination = {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Whip Target",
      nomineeParty: "2",
      nomineeCountryId: "US",
      nomineeState: "US_TX",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fallbackNomination: SpeakerNomination = {
      ...targetNomination,
      _id: new ObjectId(),
      nomineeName: "Fallback",
      nomineeParty: npp.party,
      nomineeState: npp.homeState,
    };

    const collections = createCollectionMap();
    collections.speakerNominations.find.mockReturnValue(
      makeCursor([targetNomination, fallbackNomination])
    );
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToLeadership } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToLeadership(
      db,
      targetNomination._id,
      "speakerNominations",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 1 });
    expect(collections.speakerNominations.updateOne).toHaveBeenCalledWith(
      { _id: fallbackNomination._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "for",
        }),
      })
    );
    randomSpy.mockRestore();
  });

  it("casts a deterministic fallback confidence vote instead of skipping the NPP on a soft whip", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp({ countryId: "UK", party: "lab" });
    const official = makeOfficial(npp._id, { countryId: "UK", officeType: "commons" });
    const voteId = new ObjectId();

    const collections = createCollectionMap();
    collections.noConfidenceVotes.findOne.mockResolvedValue({
      _id: voteId,
      countryId: "UK",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
    });
    collections.governmentFormations.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      governingPartyId: "lab",
      coalitionPartyIds: ["lab"],
    });
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToGovernmentVote } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToGovernmentVote(
      db,
      voteId,
      "noConfidenceVote",
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 1 });
    expect(collections.noConfidenceVotes.updateOne).toHaveBeenCalledWith(
      { _id: voteId },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "nay",
        }),
      })
    );
    randomSpy.mockRestore();
  });

  it("casts a deterministic fallback cabinet vote instead of leaving the seat unvoted on a soft whip", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const nominationId = new ObjectId();
    const nomination: CabinetNomination = {
      _id: nominationId,
      countryId: "US",
      positionId: "secretary_of_state",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "Nominee",
      nomineeParty: "2",
      proposedByPresidentId: new ObjectId(),
      proposedByPresidentName: "President",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const collections = createCollectionMap();
    collections.cabinetNominations.findOne.mockResolvedValue(nomination);
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToCabinet } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToCabinet(
      db,
      nominationId,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 1 });
    expect(collections.cabinetNominations.updateOne).toHaveBeenCalledWith(
      { _id: nominationId },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "against",
        }),
        $inc: expect.objectContaining({ votesAgainst: 1 }),
      })
    );
    randomSpy.mockRestore();
  });

  it("forces a maximally-stubborn NPP to obey a hard leadership whip", async () => {
    // random 0.99 → roll 100, which fails even the best compliance chance,
    // so under the probabilistic gate this NPP would fall back. A hard
    // leadership whip must override that and cast the directed vote.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const targetNomination: SpeakerNomination = {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Whip Target",
      nomineeParty: "2",
      nomineeCountryId: "US",
      nomineeState: "US_TX",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const fallbackNomination: SpeakerNomination = {
      ...targetNomination,
      _id: new ObjectId(),
      nomineeName: "Fallback",
      nomineeParty: npp.party,
      nomineeState: npp.homeState,
    };

    const collections = createCollectionMap();
    collections.speakerNominations.find.mockReturnValue(
      makeCursor([targetNomination, fallbackNomination])
    );
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToLeadership } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToLeadership(
      db,
      targetNomination._id,
      "speakerNominations",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.speakerNominations.updateOne).toHaveBeenCalledWith(
      { _id: targetNomination._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "for",
        }),
      })
    );
    randomSpy.mockRestore();
  });

  it("forces a maximally-stubborn NPP to obey a hard government (PM/confidence) whip", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp({ countryId: "UK", party: "lab" });
    const official = makeOfficial(npp._id, { countryId: "UK", officeType: "commons" });
    const voteId = new ObjectId();

    const collections = createCollectionMap();
    collections.noConfidenceVotes.findOne.mockResolvedValue({
      _id: voteId,
      countryId: "UK",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
    });
    collections.governmentFormations.findOne.mockResolvedValue({
      _id: "UK",
      countryId: "UK",
      governingPartyId: "lab",
      coalitionPartyIds: ["lab"],
    });
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToGovernmentVote } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToGovernmentVote(
      db,
      voteId,
      "noConfidenceVote",
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.noConfidenceVotes.updateOne).toHaveBeenCalledWith(
      { _id: voteId },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "aye",
        }),
      })
    );
    randomSpy.mockRestore();
  });

  it("forces a maximally-stubborn NPP to obey a hard cabinet whip", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const nominationId = new ObjectId();
    const nomination: CabinetNomination = {
      _id: nominationId,
      countryId: "US",
      positionId: "secretary_of_state",
      nomineeCharacterId: new ObjectId(),
      nomineeCharacterName: "Nominee",
      nomineeParty: "2",
      proposedByPresidentId: new ObjectId(),
      proposedByPresidentName: "President",
      status: "active",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const collections = createCollectionMap();
    collections.cabinetNominations.findOne.mockResolvedValue(nomination);
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToCabinet } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToCabinet(
      db,
      nominationId,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.cabinetNominations.updateOne).toHaveBeenCalledWith(
      { _id: nominationId },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "for",
        }),
        $inc: expect.objectContaining({ votesFor: 1 }),
      })
    );
    randomSpy.mockRestore();
  });

  it("stores the final override verdict in whip-applied bill prediction snapshots", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp({ donorBaseLevel: 0 });
    const official = makeOfficial(npp._id);
    const bill: Bill = {
      _id: new ObjectId(),
      title: "Override Bill",
      summary: "Test",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: null,
      sponsorName: "Sponsor",
      status: "veto_override",
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: {},
      vetoOverrideVotes: {},
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Bill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToBill } = await import("./applyWhipVotes");
    await applyWhipVotesToBill(
      db,
      bill,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 7,
      },
      "hard"
    );

    const [ops] = collections.nppVotePredictions.bulkWrite.mock.calls[0] as [
      Array<{
        updateOne: { update: { $set: { verdict: string; resolvedVote: string } } };
      }>,
    ];
    expect(ops[0]!.updateOne.update.$set.verdict).toBe("abstain");
    expect(ops[0]!.updateOne.update.$set.resolvedVote).toBe("against");
    randomSpy.mockRestore();
  });

  it("lets a successful hard whip override a hostile bill verdict", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);
    const npp = makeNpp({ donorBaseLevel: 0 });
    const official = makeOfficial(npp._id);
    const bill: Bill = {
      _id: new ObjectId(),
      title: "Override Bill",
      summary: "Test",
      originChamber: "house",
      currentChamber: "house",
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
    } as Bill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToBill } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToBill(
      db,
      bill,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 8,
      },
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.bills.updateOne).toHaveBeenCalledWith(
      { _id: bill._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "for",
        }),
      })
    );
    randomSpy.mockRestore();
  });

  it("does not whip a foreign NPP onto a domestic bill (cross-country guard, #0699)", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);
    // A Brazilian senator (party "3") must not be voted onto a US bill even if
    // a caller mistakenly passes them in — party sequentialIds collide across
    // countries (US "3" = Reform), which is exactly how foreign NPPs leaked.
    const brNpp = makeNpp({ countryId: "BR", party: "3" });
    const brOfficial = makeOfficial(brNpp._id, { countryId: "BR" });
    const usBill: Bill = {
      _id: new ObjectId(),
      countryId: "US",
      title: "US Bill",
      summary: "Test",
      originChamber: "house",
      currentChamber: "house",
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
    } as Bill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToBill } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToBill(
      db,
      usBill,
      "for",
      [brOfficial],
      new Map([[brNpp._id.toString(), brNpp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 9,
      },
      "hard"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 0 });
    expect(collections.bills.updateOne).not.toHaveBeenCalled();
    expect(collections.nppVotePredictions.bulkWrite).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });

  it("treats soft bill whips as advisory pressure only and leaves current votes untouched", async () => {
    const npp = makeNpp({ donorBaseLevel: 0 });
    const official = makeOfficial(npp._id);
    const bill: Bill = {
      _id: new ObjectId(),
      title: "Advisory Bill",
      summary: "Test",
      originChamber: "house",
      currentChamber: "house",
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
    } as Bill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToBill } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToBill(
      db,
      bill,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 9,
      },
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 0 });
    expect(collections.bills.updateOne).not.toHaveBeenCalled();
    expect(collections.nppVotePredictions.bulkWrite).not.toHaveBeenCalled();
  });

  it("applies hard local bill whips through the stateBills collection", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);
    const npp = makeNpp({ donorBaseLevel: 0, homeState: "AZ" });
    const official = makeOfficial(npp._id, { officeType: "stateSenate", state: "AZ" });
    const bill: StateBill = {
      _id: new ObjectId(),
      stateId: "AZ",
      title: "Local Bill",
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
    } as StateBill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToStateBill } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToStateBill(
      db,
      bill,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 11,
      },
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.stateBills.updateOne).toHaveBeenCalledWith(
      { _id: bill._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.npp_${npp._id.toString()}`]: "for",
        }),
      })
    );
    const [ops] = collections.nppVotePredictions.bulkWrite.mock.calls[0] as [
      Array<{ updateOne: { filter: { stateBillId?: ObjectId } } }>,
    ];
    expect(ops[0]!.updateOne.filter.stateBillId).toEqual(bill._id);
    randomSpy.mockRestore();
  });

  it("keeps soft local bill whips advisory only", async () => {
    const npp = makeNpp({ donorBaseLevel: 0, homeState: "AZ" });
    const official = makeOfficial(npp._id, { officeType: "stateSenate", state: "AZ" });
    const bill: StateBill = {
      _id: new ObjectId(),
      stateId: "AZ",
      title: "Local Bill",
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
    } as StateBill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToStateBill } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToStateBill(
      db,
      bill,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 12,
      },
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 0 });
    expect(collections.stateBills.updateOne).not.toHaveBeenCalled();
    expect(collections.nppVotePredictions.bulkWrite).not.toHaveBeenCalled();
  });

  it("keeps already-aligned hard-whip counts even when no vote rewrite is needed", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.01);
    const npp = makeNpp({ donorBaseLevel: 0 });
    const official = makeOfficial(npp._id);
    const bill: Bill = {
      _id: new ObjectId(),
      title: "Aligned Bill",
      summary: "Test",
      originChamber: "house",
      currentChamber: "house",
      sponsorId: null,
      sponsorName: "Sponsor",
      status: "active",
      votesFor: 1,
      votesAgainst: 0,
      votesAbstain: 0,
      votes: { [`npp_${npp._id.toString()}`]: "for" },
      proposedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Bill;

    const collections = createCollectionMap();
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToBill } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToBill(
      db,
      bill,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      {
        legislationType: null,
        stateDemographicsByState: new Map(),
        currentTurn: 10,
      },
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.bills.updateOne).not.toHaveBeenCalled();
    expect(collections.nppVotePredictions.bulkWrite).not.toHaveBeenCalled();
    randomSpy.mockRestore();
  });
});
