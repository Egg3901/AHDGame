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
    project: vi.fn().mockReturnThis(),
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
    speakerVacateMotions: {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    electedOfficials: {
      findOne: vi.fn().mockResolvedValue(null),
      find: vi.fn(),
    },
    characters: {
      findOne: vi.fn().mockResolvedValue(null),
    },
    politicalParties: {
      find: vi.fn(),
    },
  };
}

/** A motion to vacate in its open, votable state. */
function makeVacateMotion(overrides: Record<string, unknown> = {}) {
  return {
    _id: "current" as const,
    status: "voting" as const,
    filedById: new ObjectId(),
    filedByName: "Filer",
    targetSpeakerId: new ObjectId(),
    targetSpeakerName: "Sitting Speaker",
    startedAt: new Date("2026-09-01T00:00:00Z"),
    endsAt: new Date("2026-09-02T00:00:00Z"),
    votes: {},
    updatedAt: new Date(),
    ...overrides,
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

  it("does not steal NPP votes from a different leadership role (ticket #1046)", async () => {
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const nppKey = `npp_${npp._id.toString()}`;
    const majorityWhipId = new ObjectId();
    const proTemporeId = new ObjectId();

    const majorityWhipNomination: SpeakerNomination & { role: string } = {
      _id: majorityWhipId,
      role: "majority_whip",
      nomineeId: new ObjectId(),
      nomineeName: "Whip Target",
      nomineeParty: "1",
      nomineeCountryId: "US",
      nomineeState: "US_IA",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "voting",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const proTemporeNomination: SpeakerNomination & { role: string } = {
      ...majorityWhipNomination,
      _id: proTemporeId,
      role: "pro_tempore",
      nomineeName: "PPT Holder",
      votesFor: 1,
      votes: { [nppKey]: "for" },
    };

    const collections = createCollectionMap();
    collections.speakerNominations.find.mockReturnValue(
      makeCursor([majorityWhipNomination, proTemporeNomination])
    );
    const db = {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;

    const { applyWhipVotesToLeadership } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToLeadership(
      db,
      majorityWhipId,
      "speakerNominations",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.speakerNominations.updateOne).toHaveBeenCalledWith(
      { _id: majorityWhipId },
      expect.objectContaining({
        $set: expect.objectContaining({
          [`votes.${nppKey}`]: "for",
        }),
      })
    );
    // Must not unset the Pro Tempore vote while applying a Majority Whip
    expect(collections.speakerNominations.updateOne).not.toHaveBeenCalledWith(
      { _id: proTemporeId },
      expect.anything()
    );
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

describe("applyWhipVotesToVacateMotion", () => {
  /** Wire a db whose collections back a single open motion to vacate. */
  function makeVacateDb(
    collections: ReturnType<typeof createCollectionMap>,
    motion: ReturnType<typeof makeVacateMotion> | null,
    opts: { speakerParty?: string; speakerStance?: { economic: number; social: number } } = {}
  ) {
    collections.speakerVacateMotions.findOne.mockResolvedValue(motion);
    collections.electedOfficials.findOne.mockResolvedValue(
      opts.speakerParty ? { party: opts.speakerParty } : null
    );
    collections.characters.findOne.mockResolvedValue(
      opts.speakerStance ? { policies: opts.speakerStance } : null
    );
    collections.politicalParties.find.mockReturnValue(
      makeCursor([
        { sequentialId: 1, tier: "major" },
        { sequentialId: 2, tier: "major" },
      ])
    );
    return {
      collection: vi.fn((name: string) => collections[name as keyof typeof collections]),
    } as unknown as Db;
  }

  it("overwrites an NPP's existing ballot under a hard whip", async () => {
    // The motion may already carry auto-cast votes from a closing window; a
    // whip issued afterwards has to be able to move them.
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const nppKey = `npp_${npp._id.toString()}`;
    const motion = makeVacateMotion({ votes: { [nppKey]: "against" } });

    const collections = createCollectionMap();
    const db = makeVacateDb(collections, motion, { speakerParty: "2" });

    const { applyWhipVotesToVacateMotion } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToVacateMotion(
      db,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.speakerVacateMotions.updateOne).toHaveBeenCalledWith(
      { _id: "current", status: "voting" },
      expect.objectContaining({ $set: expect.objectContaining({ [`votes.${nppKey}`]: "for" }) })
    );
  });

  it("counts an already-aligned NPP without rewriting the motion", async () => {
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const nppKey = `npp_${npp._id.toString()}`;
    const motion = makeVacateMotion({ votes: { [nppKey]: "for" } });

    const collections = createCollectionMap();
    const db = makeVacateDb(collections, motion, { speakerParty: "2" });

    const { applyWhipVotesToVacateMotion } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToVacateMotion(
      db,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(collections.speakerVacateMotions.updateOne).not.toHaveBeenCalled();
  });

  it("falls back to the bloc's own heuristic when a soft whip is resisted", async () => {
    // roll 100 fails even the best compliance chance, so this NPP resists.
    // It shares the Speaker's party, so its own heuristic keeps the chair.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp({ party: "1" });
    const official = makeOfficial(npp._id);
    const nppKey = `npp_${npp._id.toString()}`;

    const collections = createCollectionMap();
    const db = makeVacateDb(collections, makeVacateMotion(), { speakerParty: "1" });

    const { applyWhipVotesToVacateMotion } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToVacateMotion(
      db,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 1 });
    expect(collections.speakerVacateMotions.updateOne).toHaveBeenCalledWith(
      { _id: "current", status: "voting" },
      expect.objectContaining({ $set: expect.objectContaining({ [`votes.${nppKey}`]: "against" }) })
    );
    randomSpy.mockRestore();
  });

  it("is a no-op when no motion is open", async () => {
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const collections = createCollectionMap();
    const db = makeVacateDb(collections, null);

    const { applyWhipVotesToVacateMotion } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToVacateMotion(
      db,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 0 });
    expect(collections.speakerVacateMotions.updateOne).not.toHaveBeenCalled();
  });

  it("ignores a resolved motion", async () => {
    const npp = makeNpp();
    const official = makeOfficial(npp._id);
    const collections = createCollectionMap();
    const db = makeVacateDb(collections, makeVacateMotion({ status: "passed" }));

    const { applyWhipVotesToVacateMotion } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToVacateMotion(
      db,
      "for",
      [official],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 0 });
    expect(collections.speakerVacateMotions.updateOne).not.toHaveBeenCalled();
  });

  it("counts a multi-seat bloc once even when it holds several official rows", async () => {
    const npp = makeNpp();
    const collections = createCollectionMap();
    const db = makeVacateDb(collections, makeVacateMotion(), { speakerParty: "2" });

    const { applyWhipVotesToVacateMotion } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToVacateMotion(
      db,
      "for",
      [makeOfficial(npp._id), makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
  });
});
