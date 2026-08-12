/**
 * Tests for processBillVoting and the pure helpers in leadershipVoting.ts
 * (alignmentScore, castLeadershipVote).
 *
 * billVoting.ts and leadershipVoting.ts have zero existing tests despite
 * controlling how every NPP elected official votes on every active bill and
 * leadership election. These are high-stakes: bugs here silently corrupt
 * vote tallies across hundreds of documents every turn.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import type {
  NPP,
  Bill,
  ElectedOfficial,
  BillWhip,
  SpeakerElection,
  SpeakerNomination,
  HouseLeadershipElection,
  HouseLeadershipNomination,
  SenateLeadershipElection,
  SenateLeadershipNomination,
} from "@/lib/db/types";
import type { NPPContext } from "./context";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

// The v1.7 opposition gate. Mocked to true so tests can exercise the
// opposition-identification path without wiring up the full gameState /
// countryGameStates config chain `nppAutonomyAtLeast` otherwise reads. Every
// existing test's governmentFormations doc is either null or lacks
// `status: "formed"`, so the opposition path stays inert for them regardless
// of this gate's value.
const { atLeastMock } = vi.hoisted(() => ({ atLeastMock: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/nppAutonomy/featureFlag", () => ({
  nppAutonomyAtLeast: (...args: unknown[]) => atLeastMock(...args),
}));

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function makeNPP(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    homeState: "US_CA",
    party: "1",
    countryId: "US",
    policies: { economic: 0, social: 0 },
    personality: { loyalty: 80, ambition: 50, stubbornness: 20 },
    politicalInfluence: 10,
    favorability: 50,
    currentOffice: "house",
    generatedAt: new Date(),
    retiredAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPP;
}

function makeOfficial(
  nppId: ObjectId,
  officeType: "house" | "senate",
  overrides: Partial<ElectedOfficial> = {}
): ElectedOfficial {
  return {
    _id: new ObjectId(),
    countryId: "US",
    officeType,
    characterId: null,
    isNPP: true,
    nppId,
    seatsHeld: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ElectedOfficial;
}

function makeBill(overrides: Partial<Bill> = {}): Bill {
  return {
    _id: new ObjectId(),
    title: "Test Bill",
    summary: "A test bill",
    originChamber: "house",
    currentChamber: "house",
    sponsorId: null,
    sponsorName: "Sponsor",
    status: "active",
    votesFor: 0,
    votesAgainst: 0,
    votesAbstain: 0,
    votes: {},
    votingEndsAt: new Date(Date.now() + 3_600_000),
    proposedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Bill;
}

function makeWhip(overrides: Partial<BillWhip> = {}): BillWhip {
  return {
    _id: new ObjectId(),
    targetType: "bill",
    targetId: new ObjectId(),
    chamber: "house",
    direction: "for",
    issuedBy: "nationalParty",
    countryId: "US",
    partyId: "1",
    attemptNumber: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as BillWhip;
}

/** Build a minimal NPPContext for testing processBillVoting */
function makeCtx(db: Db, overrides: Partial<NPPContext> = {}): NPPContext {
  return {
    db,
    now: new Date(),
    allNPPs: [],
    nppMap: new Map(),
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

/** Create a simple mock db that tracks updateOne calls per collection.
 * Optional `governorAddresses` seeding lets agenda-bonus tests provide active
 * national-address rows that processBillVoting will pre-fetch. */
function makeMockDb(opts: { governorAddresses?: unknown[] } = {}) {
  const calls: Record<string, unknown[][]> = {
    bills: [],
    speakerNominations: [],
    houseLeadershipNominations: [],
    senateLeadershipNominations: [],
    nppVotePredictions: [],
  };
  const db = {
    collection: vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (!calls[name]) calls[name] = [];
        calls[name].push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      // Phase 4: processBillVoting reads gameState.currentTurn and bulk-writes
      // nppVotePredictions. Tests don't assert on the prediction snapshots, so
      // these mocks just succeed silently.
      findOne: vi.fn(() => Promise.resolve({ _id: "current", currentTurn: 0 })),
      bulkWrite: vi.fn((...args: unknown[]) => {
        if (!calls[name]) calls[name] = [];
        calls[name].push(args);
        return Promise.resolve({ modifiedCount: 0, upsertedCount: 0 });
      }),
      // governorAddresses.find().toArray() — the national-address agenda
      // pre-fetch. Other find() callers (none in this test) get an empty list.
      find: vi.fn(() => ({
        toArray: vi
          .fn()
          .mockResolvedValue(name === "governorAddresses" ? (opts.governorAddresses ?? []) : []),
      })),
    })),
    _calls: calls,
  };
  return db as unknown as Db & { _calls: typeof calls };
}

// ─── processBillVoting ─────────────────────────────────────────────────────────

describe("processBillVoting", () => {
  it("returns 0 when there are no active bills", async () => {
    const db = makeMockDb();
    const ctx = makeCtx(db, { activeBills: [] });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(0);
  });

  it("returns 0 when there are no NPP officials in the relevant chamber", async () => {
    const bill = makeBill({ currentChamber: "house", status: "active" });
    const db = makeMockDb();
    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [], // no officials at all
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(0);
  });

  it("skips officials without an nppId", async () => {
    const bill = makeBill();
    const officialWithoutNpp = {
      ...makeOfficial(new ObjectId(), "house"),
      nppId: undefined,
    } as ElectedOfficial;
    const db = makeMockDb();
    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [officialWithoutNpp],
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(0);
  });

  it("skips an NPP that is not in the nppMap", async () => {
    const nppId = new ObjectId();
    const bill = makeBill();
    const official = makeOfficial(nppId, "house");
    const db = makeMockDb();
    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map(), // empty — npp not found
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(0);
  });

  it("skips an NPP that already voted (existingVotes contains nppKey)", async () => {
    const npp = makeNPP();
    const nppKey = `npp_${npp._id.toString()}`;
    const bill = makeBill({
      votes: { [nppKey]: "for" }, // already voted
    });
    const official = makeOfficial(npp._id, "house");
    const db = makeMockDb();
    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(0);
  });

  it("casts a vote and calls bills.updateOne with $set and $inc", async () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const bill = makeBill({ currentChamber: "house", status: "active" });
    const official = makeOfficial(npp._id, "house");
    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);

    expect(count).toBe(1);
    expect(updateOneCalls.length).toBe(1);
    const [filter, update] = updateOneCalls[0] as [unknown, Record<string, unknown>];
    expect(filter).toMatchObject({ _id: bill._id });
    // $set should include the npp vote entry under 'votes'
    const setFields = update.$set as Record<string, unknown>;
    const nppKey = `npp_${npp._id.toString()}`;
    expect(Object.keys(setFields)).toContain(`votes.${nppKey}`);
    // $inc should touch at least one of the vote tally counters
    const incFields = update.$inc as Record<string, number>;
    const totalInc =
      (incFields.votesFor ?? 0) + (incFields.votesAgainst ?? 0) + (incFields.votesAbstain ?? 0);
    expect(totalInc).toBe(1); // one vote worth weight 1
  });

  it("counts seatsHeld correctly in the vote tally (multi-seat NPP)", async () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const bill = makeBill({ currentChamber: "house", status: "active" });
    // This NPP holds 7 seats (multi-seat election win)
    const official = makeOfficial(npp._id, "house", { seatsHeld: 7 });
    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    const [, update] = updateOneCalls[0] as [unknown, unknown];
    const incFields = (update as { $inc: Record<string, number> }).$inc;
    const totalInc =
      (incFields.votesFor ?? 0) + (incFields.votesAgainst ?? 0) + (incFields.votesAbstain ?? 0);
    // The 7-seat NPP must contribute exactly 7 to the tally
    expect(totalInc).toBe(7);
  });

  it("deduplicates duplicate electedOfficials records so the tally is not inflated", async () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const bill = makeBill({ currentChamber: "house", status: "active" });
    // Two duplicate records for the same NPP (stale appointment / race-condition bug)
    const official1 = makeOfficial(npp._id, "house", { seatsHeld: 1 });
    const official2 = makeOfficial(npp._id, "house", { seatsHeld: 1 });
    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official1, official2],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);

    // Only one unique NPP voted
    expect(count).toBe(1);
    const [, update] = updateOneCalls[0] as [unknown, unknown];
    const incFields = (update as { $inc: Record<string, number> }).$inc;
    const totalInc =
      (incFields.votesFor ?? 0) + (incFields.votesAgainst ?? 0) + (incFields.votesAbstain ?? 0);
    // Tally must be 1, not 2
    expect(totalInc).toBe(1);
  });

  it("uses otherChamberVotes field when bill status is active_other", async () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    // A bill passed origin chamber, now in the other chamber
    const bill = makeBill({
      currentChamber: "house",
      status: "active_other",
      otherChamberVotes: {},
    });
    const official = makeOfficial(npp._id, "house");
    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    const [, update] = updateOneCalls[0] as [unknown, Record<string, unknown>];
    const setFields = (update as { $set: Record<string, unknown> }).$set;
    const nppKey = `npp_${npp._id.toString()}`;
    // Vote must be stored under otherChamberVotes, not votes
    expect(Object.keys(setFields)).toContain(`otherChamberVotes.${nppKey}`);
    expect(Object.keys(setFields)).not.toContain(`votes.${nppKey}`);

    const incFields = (update as { $inc: Record<string, number> }).$inc;
    // Other-chamber tally fields, not primary tally
    expect(
      (incFields.otherChamberVotesFor ?? 0) +
        (incFields.otherChamberVotesAgainst ?? 0) +
        (incFields.otherChamberVotesAbstain ?? 0)
    ).toBe(1);
  });

  it("uses vetoOverrideVotes field and applies abstain→against override for veto_override bills", async () => {
    // Force abstain: loyalty=0 → abstainChance=0.25. Use a random that returns 0.1 (< 0.25 → abstain).
    // But veto override must convert abstain to against.
    // We can't inject random into processBillVoting directly, but we can run many times
    // and confirm no "abstain" ever lands in vetoOverrideVotes.
    const npp = makeNPP({ personality: { loyalty: 0, ambition: 50, stubbornness: 0 } });
    const _bill = makeBill({
      status: "veto_override",
      vetoOverrideVotes: {},
      overrideVotingEndsAt: new Date(Date.now() + 3_600_000),
    });
    // Veto override uses both house and senate officials
    const houseOfficial = makeOfficial(npp._id, "house");
    const db = makeMockDb();
    const capturedSets: string[] = [];
    const collectionSpy = vi.fn((_name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        const update = args[1] as { $set: Record<string, unknown> };
        for (const key of Object.keys(update.$set ?? {})) {
          capturedSets.push(`${key}=${String(update.$set[key])}`);
        }
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    // Run 20 times; with loyalty=0 many should want to abstain, but override must prevent it
    for (let i = 0; i < 20; i++) {
      const freshBill = makeBill({
        status: "veto_override",
        vetoOverrideVotes: {},
      });
      const ctx = makeCtx(db, {
        activeBills: [freshBill],
        nppOfficials: [houseOfficial],
        nppMap: new Map([[npp._id.toString(), npp]]),
      });
      const { processBillVoting } = await import("./billVoting");
      await processBillVoting(ctx);
    }

    // None of the stored votes should be "abstain"
    const abstainVotes = capturedSets.filter((s) => s.endsWith("=abstain"));
    expect(abstainVotes.length).toBe(0);
  });

  it("uses vetoOverrideVotes field (not votes) for veto_override bills", async () => {
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const bill = makeBill({ status: "veto_override", vetoOverrideVotes: {} });
    const official = makeOfficial(npp._id, "house");
    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    const [, update] = updateOneCalls[0] as [unknown, Record<string, unknown>];
    const setFields = (update as { $set: Record<string, unknown> }).$set;
    const nppKey = `npp_${npp._id.toString()}`;
    expect(Object.keys(setFields)).toContain(`vetoOverrideVotes.${nppKey}`);
    expect(Object.keys(setFields)).not.toContain(`votes.${nppKey}`);

    const incFields = (update as { $inc: Record<string, number> }).$inc;
    // Veto override tallies for+against (no abstain field)
    expect(Object.keys(incFields)).not.toContain("vetoOverrideVotesAbstain");
    expect((incFields.vetoOverrideVotesFor ?? 0) + (incFields.vetoOverrideVotesAgainst ?? 0)).toBe(
      1
    );
  });

  it("stores the raw override verdict separately from the resolved override vote", async () => {
    const npp = makeNPP({
      donorBaseLevel: 0,
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      policies: { economic: 0, social: 0 },
    });
    const bill = makeBill({ status: "veto_override", vetoOverrideVotes: {} });
    const official = makeOfficial(npp._id, "house");
    const bulkWriteCalls: unknown[][] = [];
    const db = makeMockDb();
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn(() => Promise.resolve({ modifiedCount: 1 })),
      bulkWrite: vi.fn((...args: unknown[]) => {
        if (name === "nppVotePredictions") bulkWriteCalls.push(args);
        return Promise.resolve({ upsertedCount: 0, modifiedCount: 0 });
      }),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    const [ops] = bulkWriteCalls[0] as [
      Array<{
        updateOne: { update: { $set: { verdict: string; resolvedVote: string } } };
      }>,
    ];
    expect(ops[0]!.updateOne.update.$set.verdict).toBe("abstain");
    expect(ops[0]!.updateOne.update.$set.resolvedVote).toBe("against");
  });

  it("does not call updateOne when no new votes were cast (all already voted)", async () => {
    const npp = makeNPP();
    const nppKey = `npp_${npp._id.toString()}`;
    const bill = makeBill({ votes: { [nppKey]: "against" } }); // already voted
    const official = makeOfficial(npp._id, "house");
    const db = makeMockDb();
    const updateOneSpy = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const bulkWriteSpy = vi.fn().mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
    const collectionSpy = vi.fn(() => ({
      updateOne: updateOneSpy,
      bulkWrite: bulkWriteSpy,
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("whip directive compliance: a maximally loyal NPP always follows the whip", async () => {
    // loyalty=100, stubbornness=0 → complianceChance = 1.0 * 0.7 + 1.0 * 0.3 = 1.0 → always complies
    const npp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const bill = makeBill({ currentChamber: "senate", status: "active" });
    const official = makeOfficial(npp._id, "senate");
    const whip = makeWhip({
      targetId: bill._id,
      chamber: "senate",
      direction: "against",
      partyId: npp.party,
    });
    const db = makeMockDb();
    const capturedVotes: string[] = [];
    const collectionSpy = vi.fn((_name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        const update = args[1] as { $set: Record<string, unknown> };
        for (const [k, v] of Object.entries(update.$set ?? {})) {
          if (k.startsWith("votes.")) capturedVotes.push(String(v));
        }
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const billWhips = new Map([[bill._id.toString(), [whip]]]);
    const _ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      billWhips,
    });

    // Run multiple times to confirm determinism with compliance=1.0
    const { processBillVoting } = await import("./billVoting");
    for (let i = 0; i < 5; i++) {
      const freshBill = makeBill({ currentChamber: "senate", status: "active" });
      const ctx2 = makeCtx(db, {
        activeBills: [freshBill],
        nppOfficials: [official],
        nppMap: new Map([[npp._id.toString(), npp]]),
        billWhips: new Map([[freshBill._id.toString(), [{ ...whip, targetId: freshBill._id }]]]),
      });
      await processBillVoting(ctx2);
    }

    // All captured votes must be "against" (whip direction)
    expect(capturedVotes.every((v) => v === "against")).toBe(true);
  });

  it("applies national-address agenda force bias on co-partisan federal bill", async () => {
    // Seed: bill in "economic" category sponsored by party "1" in country US.
    // Active national address from party "1" emphasizing "economic". The
    // ideology force recorded in nppVotePredictions should pick up +8 vs the
    // no-address baseline. NPP is set to neutral policies + neutral district
    // so the only signed contribution to ideology force comes from the
    // address bonus (everything else clamps to ~0).
    const npp = makeNPP({
      party: "1",
      policies: { economic: 0, social: 0 },
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      donorBaseLevel: 0,
    });
    const official = makeOfficial(npp._id, "house");
    const bill = makeBill({
      countryId: "US",
      category: "economic",
      sponsorParty: "1",
      currentChamber: "house",
      status: "active",
    });

    const bulkWriteCalls: unknown[][] = [];
    const db = makeMockDb({
      governorAddresses: [
        {
          _id: new ObjectId(),
          countryId: "US",
          stateId: "federal",
          emphasizedCategories: ["economic"],
          agendaEffect: { partyId: "1", expiresAtTurn: 9999 },
        },
      ],
    });
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn(() => Promise.resolve({ modifiedCount: 1 })),
      bulkWrite: vi.fn((...args: unknown[]) => {
        if (name === "nppVotePredictions") bulkWriteCalls.push(args);
        return Promise.resolve({ upsertedCount: 0, modifiedCount: 0 });
      }),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue(
          name === "governorAddresses"
            ? [
                {
                  _id: new ObjectId(),
                  countryId: "US",
                  stateId: "federal",
                  emphasizedCategories: ["economic"],
                  agendaEffect: { partyId: "1", expiresAtTurn: 9999 },
                },
              ]
            : []
        ),
      })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      currentTurn: 100,
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    const [ops] = bulkWriteCalls[0] as [
      Array<{
        updateOne: {
          update: {
            $set: {
              forces: { ideology: number };
              resolvedVote: string;
            };
          };
        };
      }>,
    ];
    expect(ops).toHaveLength(1);
    // Without the bonus, neutral NPP + neutral bill yields ideology ~0.
    // With the +8 bias the persisted force lands at ~8.
    expect(ops[0]!.updateOne.update.$set.forces.ideology).toBeGreaterThanOrEqual(8);
  });

  it("does not let an NPP vote on a bill from a different country (cross-country leak)", async () => {
    // Regression for bug #0699: BR and US both use officeType "senate", so the
    // global officialsByOfficeType grouping pulled Brazilian senators into the
    // US Senate tally. Their party sequentialId then collided with US parties
    // (BR party 3 → mislabeled "Reform Party"; BR 5/6/7/8 → raw numbers). A
    // foreign NPP must never vote on another country's bill.
    const usBill = makeBill({ countryId: "US", currentChamber: "senate", status: "active" });
    const brNpp = makeNPP({ countryId: "BR", party: "3" });
    const brOfficial = makeOfficial(brNpp._id, "senate", { countryId: "BR" });
    const db = makeMockDb();
    const ctx = makeCtx(db, {
      activeBills: [usBill],
      nppOfficials: [brOfficial],
      nppMap: new Map([[brNpp._id.toString(), brNpp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(0);
    expect(db._calls.bills).toHaveLength(0);
  });

  it("identifies the opposition from a live seat tally, ignoring a stale gov.seatsByParty", async () => {
    // Regression for the stale-cache defect: `governmentFormations.seatsByParty`
    // is a write-triggered cache that can drift arbitrarily far from the real
    // chamber (measured in the field: BR/NG summed to 0 against real totals of
    // 513/360). Live chamber: governing party "1" holds 60, party "2" holds 5,
    // party "3" holds 40 → the REAL opposition is party "3". The stored
    // (stale) doc says the opposite — party "2" dominant, party "3" negligible.
    // If the stale doc were read, party "2" would wrongly bloc-vote against
    // the government's bill instead of party "3".
    const party2Npp = makeNPP({
      countryId: "BR",
      party: "2",
      policies: { economic: 0, social: 0 },
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      donorBaseLevel: 0,
    });
    const party3Npp = makeNPP({
      countryId: "BR",
      party: "3",
      policies: { economic: 0, social: 0 },
      personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
      donorBaseLevel: 0,
    });
    const official2 = makeOfficial(party2Npp._id, "house", { countryId: "BR", party: "2" });
    const official3 = makeOfficial(party3Npp._id, "house", { countryId: "BR", party: "3" });
    const bill = makeBill({
      countryId: "BR",
      sponsorParty: "1",
      currentChamber: "house",
      status: "active",
    });

    const bulkWriteCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn(() => Promise.resolve({ modifiedCount: 1 })),
      bulkWrite: vi.fn((...args: unknown[]) => {
        if (name === "nppVotePredictions") bulkWriteCalls.push(args);
        return Promise.resolve({ upsertedCount: 0, modifiedCount: 0 });
      }),
      findOne: vi.fn(() => {
        if (name === "governmentFormations") {
          return Promise.resolve({
            _id: "BR",
            status: "formed",
            governingPartyId: "1",
            // Stale cache: opposite of the live chamber composition below.
            seatsByParty: { "1": 60, "2": 500, "3": 1 },
          });
        }
        return Promise.resolve(null);
      }),
      find: vi.fn(() => ({
        toArray: vi.fn().mockResolvedValue(
          name === "electedOfficials"
            ? [
                { officeType: "chamber", countryId: "BR", party: "1", seatsHeld: 60 },
                { officeType: "chamber", countryId: "BR", party: "2", seatsHeld: 5 },
                { officeType: "chamber", countryId: "BR", party: "3", seatsHeld: 40 },
              ]
            : []
        ),
      })),
    }));
    const db = { collection: collectionSpy } as unknown as Db;

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [official2, official3],
      nppMap: new Map([
        [party2Npp._id.toString(), party2Npp],
        [party3Npp._id.toString(), party3Npp],
      ]),
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    type Prediction = { nppId: ObjectId; forces: { ideology: number } };
    const ops = (
      bulkWriteCalls[0] as [
        Array<{ updateOne: { filter: { nppId: ObjectId }; update: { $set: Prediction } } }>,
      ]
    )[0];
    const forceFor = (nppId: ObjectId) =>
      ops.find((op) => op.updateOne.filter.nppId.equals(nppId))!.updateOne.update.$set.forces
        .ideology;

    // Party "3" is the LIVE opposition — it must carry the negative
    // opposition-bloc force against the governing party's bill.
    expect(forceFor(party3Npp._id)).toBeLessThan(0);
    // Party "2" is NOT the opposition once seats are tallied live (it only
    // looks dominant in the stale cache) — it must carry no opposition force.
    expect(forceFor(party2Npp._id)).toBe(0);
  });

  it("still lets a same-country NPP vote (BR senator on BR senate bill)", async () => {
    const brBill = makeBill({ countryId: "BR", currentChamber: "senate", status: "active" });
    const brNpp = makeNPP({
      countryId: "BR",
      party: "1",
      personality: { loyalty: 100, ambition: 50, stubbornness: 0 },
    });
    const brOfficial = makeOfficial(brNpp._id, "senate", { countryId: "BR" });
    const db = makeMockDb();
    const ctx = makeCtx(db, {
      activeBills: [brBill],
      nppOfficials: [brOfficial],
      nppMap: new Map([[brNpp._id.toString(), brNpp]]),
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);
    expect(count).toBe(1);
  });

  it("processes multiple bills in the same turn independently", async () => {
    const npp1 = makeNPP();
    const npp2 = makeNPP({ party: "2" });
    const bill1 = makeBill({ currentChamber: "house" });
    const bill2 = makeBill({ currentChamber: "senate" });
    const houseOfficial = makeOfficial(npp1._id, "house");
    const senateOfficial = makeOfficial(npp2._id, "senate");

    const db = makeMockDb();
    const billUpdateCalls: Array<[unknown, unknown]> = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") billUpdateCalls.push([args[0], args[1]]);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const nppMap = new Map([
      [npp1._id.toString(), npp1],
      [npp2._id.toString(), npp2],
    ]);
    const ctx = makeCtx(db, {
      activeBills: [bill1, bill2],
      nppOfficials: [houseOfficial, senateOfficial],
      nppMap,
    });
    const { processBillVoting } = await import("./billVoting");
    const count = await processBillVoting(ctx);

    // Each bill gets one NPP vote
    expect(count).toBe(2);
    expect(billUpdateCalls.length).toBe(2);

    // Each updateOne targets a different bill
    const updatedBillIds = billUpdateCalls.map(([filter]) => (filter as { _id: ObjectId })._id);
    expect(updatedBillIds).toContainEqual(bill1._id);
    expect(updatedBillIds).toContainEqual(bill2._id);
  });
  it("regression — NPP voting handles provision-less crisis-aid bills without throwing", async () => {
    // Crisis-aid appropriation bills are created with category: "foreign policy",
    // provisions: [], no legislationTypeId, and a crisisAidId. The cross-pressure
    // engine must degrade gracefully to a zero-force verdict (abstain) and cast a
    // vote rather than throwing.
    const npp = makeNPP({ personality: { loyalty: 50, ambition: 50, stubbornness: 50 } });
    const official = makeOfficial(npp._id, "house");
    const crisisAidBill = makeBill({
      currentChamber: "house",
      status: "active",
      category: "foreign policy",
      provisions: [],
      // No legislationTypeId — crisis-aid bills are not typed
      legislationTypeId: undefined,
      // Extra field that identifies this as a crisis-aid appropriation
      crisisAidId: new ObjectId(),
    } as Partial<Bill>);

    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;

    const ctx = makeCtx(db, {
      activeBills: [crisisAidBill],
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      // No legislationTypeMap entry for this bill (it has no legislationTypeId)
      legislationTypeMap: new Map(),
    });

    const { processBillVoting } = await import("./billVoting");

    // Must NOT throw
    let count: number;
    await expect(
      (async () => {
        count = await processBillVoting(ctx);
      })()
    ).resolves.not.toThrow();

    // Must have produced exactly one vote (for/against/abstain)
    expect(count!).toBe(1);
    expect(updateOneCalls).toHaveLength(1);

    const [, update] = updateOneCalls[0] as [unknown, Record<string, unknown>];
    const setFields = (update as { $set: Record<string, unknown> }).$set;
    const nppKey = `npp_${npp._id.toString()}`;
    expect(Object.keys(setFields)).toContain(`votes.${nppKey}`);

    const vote = setFields[`votes.${nppKey}`] as string;
    expect(["for", "against", "abstain"]).toContain(vote);

    const incFields = (update as { $inc: Record<string, number> }).$inc;
    const totalInc =
      (incFields.votesFor ?? 0) + (incFields.votesAgainst ?? 0) + (incFields.votesAbstain ?? 0);
    // Should tally exactly 1 vote unit
    expect(totalInc).toBe(1);
  });
});

// ─── alignmentScore ────────────────────────────────────────────────────────────

describe("alignmentScore", () => {
  it("returns 100 for identical positions", async () => {
    const { alignmentScore } = await import("./leadershipVoting");
    expect(alignmentScore(0, 0, 0, 0)).toBe(100);
  });

  it("returns 0 when positions are maximally different", async () => {
    const { alignmentScore } = await import("./leadershipVoting");
    // Each axis: |5 - (-5)| * 5 = 50; total penalty = 100 → 100 - 100 = 0
    expect(alignmentScore(-5, -5, 5, 5)).toBe(0);
  });

  it("never returns below 0", async () => {
    const { alignmentScore } = await import("./leadershipVoting");
    // Beyond normal range — should clamp via Math.max
    expect(alignmentScore(-100, -100, 100, 100)).toBe(0);
  });

  it("penalises 5-unit difference on one axis by 25 points", async () => {
    const { alignmentScore } = await import("./leadershipVoting");
    // |5 - 0| * 5 = 25 penalty → 75
    expect(alignmentScore(0, 0, 5, 0)).toBe(75);
  });

  it("penalises both axes independently", async () => {
    const { alignmentScore } = await import("./leadershipVoting");
    // econ diff = 2 → 10, soc diff = 3 → 15 → total penalty = 25 → 75
    expect(alignmentScore(0, 0, 2, 3)).toBe(75);
  });

  it("is symmetric (order of arguments doesn't matter for score)", async () => {
    const { alignmentScore } = await import("./leadershipVoting");
    expect(alignmentScore(1, -2, 3, 4)).toBe(alignmentScore(3, 4, 1, -2));
  });
});

// ─── castLeadershipVote ────────────────────────────────────────────────────────

describe("castLeadershipVote", () => {
  function makeNomination(overrides: Partial<SpeakerNomination> = {}): SpeakerNomination {
    return {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Test Nominee",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as SpeakerNomination;
  }

  it("casts a vote for the target nomination when not already voted", async () => {
    const { castLeadershipVote } = await import("./leadershipVoting");
    const nom = makeNomination();
    const nppKey = "npp_abc123";
    const updateOneCalls: unknown[][] = [];
    const db = {
      collection: vi.fn(() => ({
        updateOne: vi.fn((...args: unknown[]) => {
          updateOneCalls.push(args);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      })),
    } as unknown as Db;

    const result = await castLeadershipVote(
      db,
      "speakerNominations",
      [nom],
      nppKey,
      nom._id,
      new Date()
    );

    expect(result).toBe(true);
    expect(updateOneCalls.length).toBe(1);
    const [filter, update] = updateOneCalls[0] as [
      { _id: ObjectId },
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    expect(filter._id).toEqual(nom._id);
    expect(update.$set[`votes.${nppKey}`]).toBe("for");
    expect(update.$inc.votesFor).toBe(1);
  });

  it("returns false and does not write if already voted for the same nomination", async () => {
    const { castLeadershipVote } = await import("./leadershipVoting");
    const nppKey = "npp_abc123";
    const nom = makeNomination({ votes: { [nppKey]: "for" } });
    const updateOneSpy = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ updateOne: updateOneSpy })),
    } as unknown as Db;

    const result = await castLeadershipVote(
      db,
      "speakerNominations",
      [nom],
      nppKey,
      nom._id,
      new Date()
    );

    expect(result).toBe(false);
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("removes previous vote for a different nomination before casting new one", async () => {
    const { castLeadershipVote } = await import("./leadershipVoting");
    const nppKey = "npp_abc123";
    const nom1 = makeNomination({ votes: { [nppKey]: "for" } }); // previously voted here
    const nom2 = makeNomination(); // new target

    const updateOneCalls: unknown[][] = [];
    const db = {
      collection: vi.fn(() => ({
        updateOne: vi.fn((...args: unknown[]) => {
          updateOneCalls.push(args);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      })),
    } as unknown as Db;

    const result = await castLeadershipVote(
      db,
      "speakerNominations",
      [nom1, nom2],
      nppKey,
      nom2._id,
      new Date()
    );

    expect(result).toBe(true);
    // Two updateOne calls: remove from nom1, add to nom2
    expect(updateOneCalls.length).toBe(2);

    // First call removes previous vote from nom1
    const [removeFilter, removeUpdate] = updateOneCalls[0] as [
      { _id: ObjectId },
      { $unset: Record<string, string>; $inc: Record<string, number> },
    ];
    expect(removeFilter._id).toEqual(nom1._id);
    expect(removeUpdate.$unset[`votes.${nppKey}`]).toBe("");
    expect(removeUpdate.$inc.votesFor).toBe(-1);

    // Second call adds vote to nom2
    const [addFilter, addUpdate] = updateOneCalls[1] as [
      { _id: ObjectId },
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    expect(addFilter._id).toEqual(nom2._id);
    expect((addUpdate.$set as Record<string, unknown>)[`votes.${nppKey}`]).toBe("for");
    expect(addUpdate.$inc.votesFor).toBe(1);
  });
});

// ─── processSpeakerVoting — single candidate auto-vote ────────────────────────

describe("processSpeakerVoting", () => {
  function makeContext(
    db: Db,
    npp: NPP,
    official: ElectedOfficial,
    speakerElection: SpeakerElection,
    nominations: SpeakerNomination[]
  ): NPPContext {
    return makeCtx(db, {
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection,
      speakerNominations: nominations,
      houseLeadershipElections: [],
      senateLeadershipElections: [],
    });
  }

  it("does not cast votes even when a speaker election is active", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP();
    const official = makeOfficial(npp._id, "house");
    const now = new Date();
    const election: SpeakerElection = {
      _id: "current",
      status: "voting",
      startedAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    };
    const nom: SpeakerNomination = {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Sole Candidate",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    };

    const updateOneCalls: unknown[][] = [];
    const db = {
      collection: vi.fn(() => ({
        updateOne: vi.fn((...args: unknown[]) => {
          updateOneCalls.push(args);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      })),
    } as unknown as Db;

    const ctx = makeContext(db, npp, official, election, [nom]);
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(0);
    expect(updateOneCalls).toHaveLength(0);
  });

  it("does not re-vote for sole candidate if nppKey already in votes", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP();
    const nppKey = `npp_${npp._id.toString()}`;
    const official = makeOfficial(npp._id, "house");
    const now = new Date();
    const election: SpeakerElection = {
      _id: "current",
      status: "voting",
      startedAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    };
    const nom: SpeakerNomination = {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Sole Candidate",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "voting",
      votesFor: 1,
      votesAgainst: 0,
      votes: { [nppKey]: "for" }, // already voted
      createdAt: now,
      updatedAt: now,
    };

    const updateOneSpy = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ updateOne: updateOneSpy })),
    } as unknown as Db;

    const ctx = makeContext(db, npp, official, election, [nom]);
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(0);
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("skips speaker voting when no active speaker election exists", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP();
    const official = makeOfficial(npp._id, "house");
    const updateOneSpy = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ updateOne: updateOneSpy })),
    } as unknown as Db;

    const ctx = makeCtx(db, {
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection: null, // no election
      speakerNominations: [],
      houseLeadershipElections: [],
      senateLeadershipElections: [],
    });
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(0);
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("does not cast votes when multiple speaker candidates exist", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP({ party: "1", policies: { economic: 0, social: 0 } });
    const official = makeOfficial(npp._id, "house");
    const now = new Date();
    const election: SpeakerElection = {
      _id: "current",
      status: "voting",
      startedAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    };

    // Nomination A: same party as NPP → gets PARTY_MATCH_BONUS = 80
    const nomA: SpeakerNomination = {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Same Party",
      nomineeParty: "1",
      nomineeCountryId: "US",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    };
    // Nomination B: different party → no bonus
    const nomB: SpeakerNomination = {
      _id: new ObjectId(),
      nomineeId: new ObjectId(),
      nomineeName: "Other Party",
      nomineeParty: "2",
      nomineeCountryId: "US",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    };

    const targetNomIds: ObjectId[] = [];
    const db = {
      collection: vi.fn(() => ({
        updateOne: vi.fn((filter: { _id: ObjectId }, _update: unknown) => {
          targetNomIds.push(filter._id);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      })),
    } as unknown as Db;

    const ctx = makeCtx(db, {
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection: election,
      speakerNominations: [nomA, nomB],
      houseLeadershipElections: [],
      senateLeadershipElections: [],
    });
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(0);
    expect(targetNomIds).toHaveLength(0);
  });
});

// ─── processSpeakerVoting — house/senate leadership elections ─────────────────

describe.skip("processSpeakerVoting — house leadership election", () => {
  it("auto-votes for the sole house leadership nomination", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP({ party: "1" });
    const official = makeOfficial(npp._id, "house", { party: "1" });
    const now = new Date();
    const election: HouseLeadershipElection = {
      _id: "majority_leader",
      status: "voting",
      startedAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    };
    const nom: HouseLeadershipNomination = {
      _id: new ObjectId(),
      role: "majority_leader",
      nomineeId: new ObjectId(),
      nomineeName: "Candidate",
      nomineeParty: "1",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    };

    const updateOneCalls: unknown[][] = [];
    const db = {
      collection: vi.fn(() => ({
        updateOne: vi.fn((...args: unknown[]) => {
          updateOneCalls.push(args);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      })),
    } as unknown as Db;

    const ctx = makeCtx(db, {
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection: null,
      speakerNominations: [],
      houseLeadershipElections: [election],
      houseLeadershipNominations: [nom],
      senateLeadershipElections: [],
      senateLeadershipNominations: [],
    });
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(1);
    const [, update] = updateOneCalls[0] as [
      unknown,
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    const nppKey = `npp_${npp._id.toString()}`;
    expect(update.$set[`votes.${nppKey}`]).toBe("for");
    expect(update.$inc.votesFor).toBe(1);
  });

  it("skips NPPs whose party does not match the voting party for house leadership", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP({ party: "2" }); // wrong party
    const official = makeOfficial(npp._id, "house", { party: "2" });
    const now = new Date();
    const election: HouseLeadershipElection = {
      _id: "majority_leader",
      status: "voting",
      startedAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    };
    const nom: HouseLeadershipNomination = {
      _id: new ObjectId(),
      role: "majority_leader",
      nomineeId: new ObjectId(),
      nomineeName: "Candidate",
      nomineeParty: "1", // only party "1" should vote
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    };

    const updateOneSpy = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ updateOne: updateOneSpy })),
    } as unknown as Db;

    const ctx = makeCtx(db, {
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection: null,
      speakerNominations: [],
      houseLeadershipElections: [election],
      houseLeadershipNominations: [nom],
      senateLeadershipElections: [],
      senateLeadershipNominations: [],
    });
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(0);
    expect(updateOneSpy).not.toHaveBeenCalled();
  });

  it("skips house leadership election that has already ended", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP({ party: "1" });
    const official = makeOfficial(npp._id, "house", { party: "1" });
    const now = new Date();
    const election: HouseLeadershipElection = {
      _id: "majority_leader",
      status: "voting",
      startedAt: new Date(now.getTime() - 7200_000),
      endsAt: new Date(now.getTime() - 3600_000), // already ended
      updatedAt: now,
    };

    const updateOneSpy = vi.fn().mockResolvedValue({ modifiedCount: 0 });
    const db = {
      collection: vi.fn(() => ({ updateOne: updateOneSpy })),
    } as unknown as Db;

    const ctx = makeCtx(db, {
      now, // "current time" is after endsAt
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection: null,
      speakerNominations: [],
      houseLeadershipElections: [election],
      houseLeadershipNominations: [],
      senateLeadershipElections: [],
      senateLeadershipNominations: [],
    });
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(0);
    expect(updateOneSpy).not.toHaveBeenCalled();
  });
});

describe.skip("processSpeakerVoting — senate leadership election", () => {
  it("auto-votes for the sole senate leadership nomination", async () => {
    const { processSpeakerVoting } = await import("./leadershipVoting");
    const npp = makeNPP({ party: "1", currentOffice: { type: "senate", state: "CA" } });
    const official = makeOfficial(npp._id, "senate", { party: "1" });
    const now = new Date();
    const election: SenateLeadershipElection = {
      _id: "majority_leader",
      status: "voting",
      startedAt: now,
      endsAt: new Date(now.getTime() + 3_600_000),
      updatedAt: now,
    };
    const nom: SenateLeadershipNomination = {
      _id: new ObjectId(),
      role: "majority_leader",
      nomineeId: new ObjectId(),
      nomineeName: "Senator Candidate",
      nomineeParty: "1",
      nominatedById: new ObjectId(),
      nominatedByName: "Nominator",
      status: "open",
      votesFor: 0,
      votesAgainst: 0,
      votes: {},
      createdAt: now,
      updatedAt: now,
    };

    const updateOneCalls: unknown[][] = [];
    const db = {
      collection: vi.fn(() => ({
        updateOne: vi.fn((...args: unknown[]) => {
          updateOneCalls.push(args);
          return Promise.resolve({ modifiedCount: 1 });
        }),
      })),
    } as unknown as Db;

    const ctx = makeCtx(db, {
      nppOfficials: [official],
      nppMap: new Map([[npp._id.toString(), npp]]),
      speakerElection: null,
      speakerNominations: [],
      houseLeadershipElections: [],
      houseLeadershipNominations: [],
      senateLeadershipElections: [election],
      senateLeadershipNominations: [nom],
    });
    const count = await processSpeakerVoting(ctx);

    expect(count).toBe(1);
    const [, update] = updateOneCalls[0] as [
      unknown,
      { $set: Record<string, unknown>; $inc: Record<string, number> },
    ];
    const nppKey = `npp_${npp._id.toString()}`;
    expect(update.$set[`votes.${nppKey}`]).toBe("for");
    expect(update.$inc.votesFor).toBe(1);
  });
});

describe("processBillVoting - concurrent (active_both) bills", () => {
  function spyDb() {
    const db = makeMockDb();
    const updateOneCalls: unknown[][] = [];
    const collectionSpy = vi.fn((name: string) => ({
      updateOne: vi.fn((...args: unknown[]) => {
        if (name === "bills") updateOneCalls.push(args);
        return Promise.resolve({ modifiedCount: 1 });
      }),
      bulkWrite: vi.fn(() => Promise.resolve({ upsertedCount: 0, modifiedCount: 0 })),
      findOne: vi.fn(() => Promise.resolve(null)),
      find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
    }));
    (db as unknown as { collection: typeof collectionSpy }).collection = collectionSpy;
    return { db, updateOneCalls };
  }

  it("puts BOTH chambers officials in the loop and writes to their own maps", async () => {
    const houseNpp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const senateNpp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const bill = makeBill({
      status: "active_both",
      countryId: "US",
      currentChamber: "house",
      otherChamberVotes: {},
    });
    const { db, updateOneCalls } = spyDb();

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [makeOfficial(houseNpp._id, "house"), makeOfficial(senateNpp._id, "senate")],
      nppMap: new Map([
        [houseNpp._id.toString(), houseNpp],
        [senateNpp._id.toString(), senateNpp],
      ]),
      preset: "1953-default",
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    expect(updateOneCalls.length).toBe(1);
    const [, update] = updateOneCalls[0] as [unknown, Record<string, unknown>];
    const setFields = update.$set as Record<string, unknown>;
    const incFields = update.$inc as Record<string, number>;

    // The discriminating assertion: with a single office type OR a single accumulator,
    // this is empty and the upper tally stays at zero -- which is what fails every
    // concurrent bill with no error anywhere.
    const otherKeys = Object.keys(setFields).filter((k) => k.startsWith("otherChamberVotes."));
    expect(otherKeys.length).toBe(1);
    const lowerKeys = Object.keys(setFields).filter((k) => k.startsWith("votes."));
    expect(lowerKeys.length).toBe(1);

    const otherTotal =
      (incFields.otherChamberVotesFor ?? 0) +
      (incFields.otherChamberVotesAgainst ?? 0) +
      (incFields.otherChamberVotesAbstain ?? 0);
    const lowerTotal =
      (incFields.votesFor ?? 0) + (incFields.votesAgainst ?? 0) + (incFields.votesAbstain ?? 0);
    expect(otherTotal).toBe(1);
    expect(lowerTotal).toBe(1);
  });

  it("still excludes an official from another country", async () => {
    const npp = makeNPP({ countryId: "BR" });
    const bill = makeBill({ status: "active_both", countryId: "US", currentChamber: "house" });
    const { db, updateOneCalls } = spyDb();

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [makeOfficial(npp._id, "senate", { countryId: "BR" })],
      nppMap: new Map([[npp._id.toString(), npp]]),
      preset: "1953-default",
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    expect(updateOneCalls.length).toBe(0);
  });

  it("stops voting in the chamber whose clock ran out while the other is still open", async () => {
    const houseNpp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    const senateNpp = makeNPP({ personality: { loyalty: 100, ambition: 50, stubbornness: 0 } });
    // The fetch ORs the two deadlines, so this bill is still polled — and the engine
    // will not close it until BOTH have run out. In that window the House is shut:
    // a player is refused there by the vote route, and an NPP must be too.
    const bill = makeBill({
      status: "active_both",
      countryId: "US",
      currentChamber: "house",
      votingEndsOnTurn: 5,
      otherChamberVotingEndsOnTurn: 20,
      otherChamberVotes: {},
    });
    const { db, updateOneCalls } = spyDb();

    const ctx = makeCtx(db, {
      activeBills: [bill],
      nppOfficials: [makeOfficial(houseNpp._id, "house"), makeOfficial(senateNpp._id, "senate")],
      nppMap: new Map([
        [houseNpp._id.toString(), houseNpp],
        [senateNpp._id.toString(), senateNpp],
      ]),
      currentTurn: 10,
      preset: "1953-default",
    });
    const { processBillVoting } = await import("./billVoting");
    await processBillVoting(ctx);

    expect(updateOneCalls.length).toBe(1);
    const [, update] = updateOneCalls[0] as [unknown, Record<string, unknown>];
    const setFields = update.$set as Record<string, unknown>;
    const incFields = update.$inc as Record<string, number>;

    // The Senate votes; the House does not.
    expect(Object.keys(setFields).filter((k) => k.startsWith("otherChamberVotes."))).toHaveLength(
      1
    );
    expect(Object.keys(setFields).filter((k) => k.startsWith("votes."))).toHaveLength(0);
    expect(incFields.votesFor ?? 0).toBe(0);
    expect(incFields.votesAgainst ?? 0).toBe(0);
    expect(incFields.votesAbstain ?? 0).toBe(0);
  });
});
