import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { ElectedOfficial, NPP } from "@/lib/db/types";

function makeCursor<T>(docs: T[]) {
  return {
    toArray: vi.fn().mockResolvedValue(docs),
    project: vi.fn().mockReturnThis(),
  };
}

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Bloc",
    countryId: "US",
    homeState: "US_CA",
    party: "2",
    policies: { economic: 0, social: 0 },
    // Maximum stubbornness: any probabilistic gate fails, so a soft whip is
    // always resisted and a hard whip must still bind.
    personality: { loyalty: 0, ambition: 50, stubbornness: 100 },
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
    ...overrides,
  } as ElectedOfficial;
}

function makeImpeachment(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    countryId: "US",
    targetCharacterId: new ObjectId(),
    targetName: "The President",
    targetOffice: "president",
    stage: "house",
    houseVotes: {},
    houseVotesFor: 0,
    houseVotesAgainst: 0,
    houseVotesAbstain: 0,
    senateVotes: {},
    senateVotesFor: 0,
    senateVotesAgainst: 0,
    senateVotesAbstain: 0,
    houseVotingEndsOnTurn: 120,
    senateVotingEndsOnTurn: null,
    ...overrides,
  };
}

function collections() {
  return {
    impeachments: {
      findOne: vi.fn(),
      updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    },
    electedOfficials: { findOne: vi.fn().mockResolvedValue(null) },
    characters: { findOne: vi.fn().mockResolvedValue(null) },
    politicalParties: { find: vi.fn() },
  };
}

function makeDb(
  colls: ReturnType<typeof collections>,
  impeachment: ReturnType<typeof makeImpeachment> | null,
  opts: { targetParty?: string } = {}
) {
  colls.impeachments.findOne.mockResolvedValue(impeachment);
  colls.electedOfficials.findOne.mockResolvedValue(
    opts.targetParty ? { party: opts.targetParty } : null
  );
  colls.characters.findOne.mockResolvedValue({ policies: { economic: 5, social: 5 } });
  colls.politicalParties.find.mockReturnValue(
    makeCursor([
      { sequentialId: 1, tier: "major" },
      { sequentialId: 2, tier: "major" },
    ])
  );
  return {
    collection: vi.fn((name: string) => colls[name as keyof typeof colls]),
  } as unknown as Db;
}

describe("applyWhipVotesToImpeachment", () => {
  it("overwrites the graded vote the lifecycle already cast", async () => {
    // processImpeachmentLifecycle votes every bloc on the first tick after
    // filing, so skip-if-voted would make the whip a no-op on a live case.
    const npp = makeNpp();
    const nppKey = `npp_${npp._id.toString()}`;
    const impeachment = makeImpeachment({ houseVotes: { [nppKey]: "nay" }, houseVotesAgainst: 1 });

    const colls = collections();
    const db = makeDb(colls, impeachment);

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    const [filter, update] = colls.impeachments.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    expect(filter).toEqual({ _id: impeachment._id, stage: "house" });
    expect(update.$set[`houseVotes.${nppKey}`]).toBe("aye");
    // The prior nay is withdrawn as the aye lands, so the counters stay true.
    expect(update.$inc).toEqual({ houseVotesFor: 1, houseVotesAgainst: -1 });
  });

  it("writes the senate map once the case has advanced to trial", async () => {
    const npp = makeNpp();
    const impeachment = makeImpeachment({ stage: "senate", senateVotingEndsOnTurn: 130 });

    const colls = collections();
    const db = makeDb(colls, impeachment);

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "against",
      [makeOfficial(npp._id, { officeType: "senate" })],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    const [filter, update] = colls.impeachments.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    expect(filter).toEqual({ _id: impeachment._id, stage: "senate" });
    expect(update.$set[`senateVotes.npp_${npp._id.toString()}`]).toBe("nay");
    expect(update.$inc).toEqual({ senateVotesAgainst: 1 });
  });

  it("weights a multi-seat bloc by its seats", async () => {
    const npp = makeNpp();
    const impeachment = makeImpeachment();

    const colls = collections();
    const db = makeDb(colls, impeachment);

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id, { seatsHeld: 12 })],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    const [, update] = colls.impeachments.updateOne.mock.calls[0] as [
      unknown,
      { $inc: Record<string, number> },
    ];
    expect(update.$inc).toEqual({ houseVotesFor: 12 });
  });

  it("falls back to the bloc's own verdict when a soft whip is resisted", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    // Same party as the target, so the bloc's own heuristic defends them.
    const npp = makeNpp({ party: "1" });
    const impeachment = makeImpeachment();

    const colls = collections();
    const db = makeDb(colls, impeachment, { targetParty: "1" });

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "soft"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 1 });
    const [, update] = colls.impeachments.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set[`houseVotes.npp_${npp._id.toString()}`]).toBe("nay");
    randomSpy.mockRestore();
  });

  it("binds a maximally stubborn bloc under a hard whip", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    const npp = makeNpp({ party: "1" });
    const impeachment = makeImpeachment();

    const colls = collections();
    const db = makeDb(colls, impeachment, { targetParty: "1" });

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    const [, update] = colls.impeachments.updateOne.mock.calls[0] as [
      unknown,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set[`houseVotes.npp_${npp._id.toString()}`]).toBe("aye");
    randomSpy.mockRestore();
  });

  it("does nothing once the case is resolved", async () => {
    const npp = makeNpp();
    const colls = collections();
    const impeachment = makeImpeachment({ stage: "convicted" });
    const db = makeDb(colls, impeachment);

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 0, ignored: 0 });
    expect(colls.impeachments.updateOne).not.toHaveBeenCalled();
  });

  it("counts an already-aligned bloc without rewriting the case", async () => {
    const npp = makeNpp();
    const nppKey = `npp_${npp._id.toString()}`;
    const impeachment = makeImpeachment({ houseVotes: { [nppKey]: "aye" }, houseVotesFor: 1 });

    const colls = collections();
    const db = makeDb(colls, impeachment);

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    expect(colls.impeachments.updateOne).not.toHaveBeenCalled();
  });

  it("counts a bloc once even when it holds several official rows", async () => {
    const npp = makeNpp();
    const impeachment = makeImpeachment();
    const colls = collections();
    const db = makeDb(colls, impeachment);

    const { applyWhipVotesToImpeachment } = await import("./applyWhipVotes");
    const result = await applyWhipVotesToImpeachment(
      db,
      impeachment._id,
      "for",
      [makeOfficial(npp._id), makeOfficial(npp._id)],
      new Map([[npp._id.toString(), npp]]),
      "hard"
    );

    expect(result).toEqual({ fellInLine: 1, ignored: 0 });
    const [, update] = colls.impeachments.updateOne.mock.calls[0] as [
      unknown,
      { $inc: Record<string, number> },
    ];
    expect(update.$inc).toEqual({ houseVotesFor: 1 });
  });
});
