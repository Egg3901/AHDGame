/**
 * Tests for NPP autonomous bill sponsorship (SP2).
 *
 * Four coverage areas as specified:
 *  1. Gate: inactive country proposes nothing.
 *  2. Throttle: at-cap proposes nothing; cooldown respected.
 *  3. Happy path: active country + urgent signal → exactly one bill, nppSponsored:true.
 *  4. selectNppBill unit: hybrid winner + deterministic tie-break.
 */

import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { selectNppBill, buildConditionsSignal } from "../selectNppBill";
import { processNppBillSponsorship } from "../../turn/npp/billSponsorship";
import type { NPPContext } from "../../turn/npp/context";
import type { NPP } from "../../db/types";
import type { ElectedOfficial } from "../../db/types/officials";
import type { LegislationType } from "../../db/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeNpp(overrides: Partial<NPP> = {}): NPP {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    party: "1",
    homeState: "federal",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic: 2, social: 1 },
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    sequentialId: 1,
    retiredAt: null,
    generatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as NPP;
}

function makeOfficial(
  nppId: ObjectId,
  countryId: string,
  officeType: string,
  party: string,
  seatsHeld = 5
): ElectedOfficial {
  return {
    _id: new ObjectId(),
    countryId: countryId as any,
    officeType: officeType as any,
    party,
    characterId: null,
    isNPP: true,
    nppId,
    seatsHeld,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeLegType(id: string, domain: string, economic = 2, social = 0): LegislationType {
  return {
    _id: id,
    name: `LegType ${id}`,
    description: `Desc ${id}`,
    policyDomain: domain,
    subCategory: "test",
    positions: [],
    policyOptions: [
      {
        id: `${id}_opt1`,
        name: "Option A",
        stance: "right",
        effectDirection: 1,
        economic,
        social,
      },
      {
        id: `${id}_opt2`,
        name: "Option B",
        stance: "left",
        effectDirection: -1,
        economic: -economic,
        social: -social,
      },
    ],
    countryScope: "us",
  } as unknown as LegislationType;
}

// ── Mock DB factory ───────────────────────────────────────────────────────────

interface MockDbOptions {
  /** Whether the autonomy flag is enabled globally */
  nppAutonomyEnabled?: boolean;
  /** Whether the country is enabled for players (true = autonomy NOT active) */
  enabledForPlayers?: boolean;
  /** Number of active nppSponsored bills (for throttle test) */
  activeNppBillCount?: number;
  /** Turn of last nppSponsored bill (for cooldown test) */
  lastNppBillVotingEndsOnTurn?: number | null;
  /** Legislation types to return */
  legTypes?: LegislationType[];
  /** Insert spy to capture bill inserts */
  insertSpy?: ReturnType<typeof vi.fn>;
  /** Whether countryState has onePartyState government */
  governmentType?: string;
  /** Explicit autonomy level (e.g. "v1") for the gameState mock. */
  nppAutonomyLevel?: string;
  /** Formed-government doc returned by governmentFormations.findOne (for V1.7). */
  governmentFormation?: Record<string, unknown> | null;
  /** Live lower-chamber rows backing the seat tally `loadGovernmentDirectives`
   *  now derives via `tallySeatsByParty` instead of trusting
   *  `governmentFormation.seatsByParty` (a write-triggered cache). */
  electedOfficials?: Array<Record<string, unknown>>;
}

function makeMockDb(opts: MockDbOptions = {}) {
  const {
    nppAutonomyEnabled = true,
    enabledForPlayers = false,
    activeNppBillCount = 0,
    lastNppBillVotingEndsOnTurn = null,
    legTypes = [],
    insertSpy = vi.fn(async (_doc: unknown) => ({ insertedId: new ObjectId() })),
    governmentType = "presidential",
    nppAutonomyLevel,
    governmentFormation = null,
    electedOfficials = [],
  } = opts;

  const billsCollection = {
    countDocuments: vi.fn(async () => activeNppBillCount),
    findOne: vi.fn(async () =>
      lastNppBillVotingEndsOnTurn !== null
        ? { votingEndsOnTurn: lastNppBillVotingEndsOnTurn }
        : null
    ),
    find: vi.fn(() => ({
      toArray: async () => [],
    })),
    insertOne: insertSpy,
  };

  const db = {
    collection: (name: string) => {
      if (name === "gameState") {
        return {
          findOne: async () => ({ nppAutonomyEnabled, nppAutonomyLevel, currentTurn: 100 }),
        };
      }
      if (name === "electedOfficials") {
        return {
          find: () => ({ toArray: async () => electedOfficials }),
        };
      }
      if (name === "governmentFormations") {
        return {
          findOne: async () => governmentFormation,
        };
      }
      if (name === "countryGameStates") {
        return {
          findOne: async () => ({ enabledForPlayers }),
        };
      }
      if (name === "bills") {
        return billsCollection;
      }
      if (name === "legislationTypes") {
        return {
          find: () => ({ toArray: async () => legTypes }),
          findOne: async (filter: any) => {
            const id = filter?._id;
            return legTypes.find((t) => t._id === id) ?? null;
          },
        };
      }
      if (name === "countryState") {
        return {
          findOne: async () => ({
            _id: "US",
            countryId: "US",
            governmentType,
            rulingPartyId: null,
            opsVoteMultipliers: null,
            hasLeaderConfidenceModel: false,
            reformCooldowns: {},
            popularBoostModifiers: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        };
      }
      if (name === "politicalParties") {
        return { findOne: async () => null };
      }
      if (name === "statePolicies") {
        return { find: () => ({ toArray: async () => [] }) };
      }
      if (name === "enactedLaws") {
        return { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
      }
      if (name === "federalBudget") {
        return {
          findOne: async () => ({ economicFactors: { inflationRate: 6.0 } }),
        };
      }
      if (name === "stateMetrics") {
        return {
          findOne: async () => ({
            economic: { gdpGrowth: { value: 1.0 } },
          }),
        };
      }
      // Default: empty stub
      return {
        findOne: async () => null,
        find: () => ({ toArray: async () => [] }),
        countDocuments: async () => 0,
        insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      };
    },
  } as unknown as import("mongodb").Db;

  return { db, insertSpy, billsCollection };
}

function makeCtx(
  db: import("mongodb").Db,
  nppOfficials: ElectedOfficial[],
  nppMap: Map<string, NPP>
): NPPContext {
  return {
    db,
    now: new Date(),
    allNPPs: [...nppMap.values()],
    nppMap,
    openPrimaries: [],
    nppCandidacies: new Set(),
    candidatesByElection: new Map(),
    nppOfficials,
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
    nppElectionEligiblePartyKeys: new Set(),
    legislationTypeMap: new Map(),
    stateDemographicsMap: new Map(),
    statesById: new Map(),
    currentTurn: 100,
  };
}

// ── Tests: Gate ───────────────────────────────────────────────────────────────

describe("processNppBillSponsorship — gate", () => {
  it("proposes nothing when nppAutonomy flag is off", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({ nppAutonomyEnabled: false });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("proposes nothing when country is player-enabled (safety rail)", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({ nppAutonomyEnabled: true, enabledForPlayers: true });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("skips an unrecognized countryId instead of throwing (incident 2026-07-22)", async () => {
    // A stale/pre-rename countryId (e.g. "BY" before 348fcf61b renamed Belarus
    // to "BLR") isn't in COUNTRY_CONFIGS. isNppAutonomyActive resolves country
    // access from that same config map and throws "Invalid country ID" rather
    // than returning false, so the COUNTRY_CONFIGS guard must run BEFORE that
    // call — otherwise one bad country's officials abort sponsorship for every
    // other country in the same turn.
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "BY", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({ nppAutonomyEnabled: true });
    const ctx = makeCtx(db, [official], nppMap);

    await expect(processNppBillSponsorship(ctx)).resolves.toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ── Tests: Legislation freeze ────────────────────────────────────────────────

describe("processNppBillSponsorship — legislation freeze", () => {
  it("proposes nothing while a parliamentary country's government is pending", async () => {
    // Parity with the player path: checkLegislationFreeze rejects a player's
    // proposal in exactly this state ("Government is in formation; legislation
    // is frozen until a PM is seated"). NPP sponsorship never consulted the
    // formation doc, so NPPs kept filing bills in a country where no player
    // could — reported in DD, whose onePartyState government counts as
    // parliamentary for the freeze.
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "DD", "volkskammerDeputy", "1", 300);
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({
      legTypes: [makeLegType("l1", "fiscal")],
      governmentFormation: { _id: "DD", status: "pending" },
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("proposes normally once that government is formed", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "DD", "volkskammerDeputy", "1", 300);
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({
      legTypes: [makeLegType("l1", "fiscal")],
      governmentFormation: { _id: "DD", status: "formed" },
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("proposes in a non-parliamentary country even with a pending gov doc", async () => {
    // US is presidential, so checkLegislationFreeze passes players straight
    // through. The NPP gate must have the same blind spot or the two diverge
    // in the other direction.
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({
      legTypes: [makeLegType("l1", "fiscal")],
      governmentFormation: { _id: "US", status: "pending" },
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: Throttle ───────────────────────────────────────────────────────────

describe("processNppBillSponsorship — throttle", () => {
  it("proposes nothing when active nppSponsored bill count >= cap", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    // cap is 2; set to 2 → throttled
    const { db, insertSpy } = makeMockDb({
      activeNppBillCount: 2,
      legTypes: [makeLegType("l1", "fiscal")],
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("proposes nothing when cooldown has not elapsed", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    // currentTurn = 100, cooldown = 12; lastBillTurn = 100 - 24 (ends) => proposal turn = (100+24)-24 = 100
    // We need cooldown not elapsed: lastTurn = 100 - 5 = 95 → votingEndsOnTurn = 95 + 24 = 119
    // Actually: lastNppSponsoredBillTurn = votingEndsOnTurn - 24 = 119 - 24 = 95
    // currentTurn - 95 = 5 < 12 → throttled
    const { db, insertSpy } = makeMockDb({
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: 100 + 24 - 5, // => proposal turn 95, gap = 5 < 12
      legTypes: [makeLegType("l1", "fiscal")],
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("allows proposal when cooldown has elapsed", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    // currentTurn - proposalTurn must be >= 12
    // proposalTurn = votingEndsOnTurn - 24
    // We want gap = 15: proposalTurn = 100 - 15 = 85 → votingEndsOnTurn = 85 + 24 = 109
    const insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() }));
    const { db } = makeMockDb({
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: 109, // proposalTurn = 85; gap = 15 >= 12 → allowed
      legTypes: [makeLegType("l1", "fiscal")],
      insertSpy,
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const callArgs = insertSpy.mock.calls[0] as unknown as [Record<string, unknown>];
    const insertedDoc = callArgs[0];
    expect(insertedDoc["nppSponsored"]).toBe(true);
  });

  it("gap of 10 stays throttled below v3 (fixed 12-turn cooldown)", async () => {
    // ideologue archetype (ambition>=50, stubbornness>=50 — makeNpp's default)
    // has legislativeActivityMult 1.4, but that only applies at v3.
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: 100 + 24 - 10, // proposalTurn 90, gap 10 < 12
      legTypes: [makeLegType("l1", "fiscal")],
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("v3 shortens the cooldown for a high-legislativeActivityMult sponsor, allowing the same gap of 10", async () => {
    // Same ideologue sponsor and gap as above, but v3 active: effective
    // cooldown = round(12 / 1.4) = 9, so gap 10 >= 9 → allowed.
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: 100 + 24 - 10, // proposalTurn 90, gap 10
      legTypes: [makeLegType("l1", "fiscal")],
      nppAutonomyLevel: "v3",
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it("v3 lengthens the cooldown for a low-legislativeActivityMult (steward) sponsor", async () => {
    // steward archetype (ambition<50, stubbornness>=50) has
    // legislativeActivityMult 0.7 → effective cooldown = round(12/0.7) = 17.
    // A gap of 15 clears the fixed 12-turn cooldown but not the scaled 17.
    const npp = makeNpp({
      sequentialId: 1,
      personality: { loyalty: 50, ambition: 20, stubbornness: 80 },
    });
    const official = makeOfficial(npp._id, "US", "house", "1");
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const { db, insertSpy } = makeMockDb({
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: 100 + 24 - 15, // proposalTurn 85, gap 15
      legTypes: [makeLegType("l1", "fiscal")],
      nppAutonomyLevel: "v3",
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ── Tests: Happy path ────────────────────────────────────────────────────────

describe("processNppBillSponsorship — happy path", () => {
  it("introduces exactly one bill with nppSponsored:true, correct sponsor and category", async () => {
    const npp = makeNpp({ sequentialId: 1 });
    const official = makeOfficial(npp._id, "US", "house", "1", 10);
    const nppMap = new Map([[npp._id.toString(), npp]]);
    const legType = makeLegType("fiscal_type", "fiscal");
    const insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() }));
    const { db } = makeMockDb({
      nppAutonomyEnabled: true,
      enabledForPlayers: false,
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: null, // no prior bill
      legTypes: [legType],
      insertSpy,
    });
    const ctx = makeCtx(db, [official], nppMap);

    const count = await processNppBillSponsorship(ctx);

    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const billArgs = insertSpy.mock.calls[0] as unknown as [Record<string, unknown>];
    const bill = billArgs[0];

    // Core nppSponsored marker
    expect(bill["nppSponsored"]).toBe(true);
    // Sponsor should be the NPP's _id
    expect((bill["sponsorId"] as any).toString()).toBe(npp._id.toString());
    // Sponsor name
    expect(bill["sponsorName"]).toBe(npp.name);
    // Status active
    expect(bill["status"]).toBe("active");
    // Has provisions
    expect(bill["provisions"]).toBeDefined();
    expect(Array.isArray(bill["provisions"])).toBe(true);
    expect((bill["provisions"] as unknown[]).length).toBeGreaterThan(0);
    // Voting ends in 24 turns
    expect(bill["votingEndsOnTurn"]).toBe(100 + 24);
    // Country
    expect(bill["countryId"]).toBe("US");
  });

  it("picks majority-party NPP as sponsor (deterministic lowest sequentialId)", async () => {
    const npp1 = makeNpp({ sequentialId: 2, party: "1", name: "NPP B" });
    const npp2 = makeNpp({ sequentialId: 1, party: "1", name: "NPP A" }); // lower seq → picks this
    const npp3 = makeNpp({ sequentialId: 3, party: "2", name: "NPP C" });

    // Party "1" has 12 seats; party "2" has 3 seats
    const off1 = makeOfficial(npp1._id, "US", "house", "1", 5);
    const off2 = makeOfficial(npp2._id, "US", "house", "1", 7);
    const off3 = makeOfficial(npp3._id, "US", "house", "2", 3);

    const nppMap = new Map([
      [npp1._id.toString(), npp1],
      [npp2._id.toString(), npp2],
      [npp3._id.toString(), npp3],
    ]);

    const legType = makeLegType("eco_type", "economic_growth");
    const insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() }));
    const { db } = makeMockDb({
      nppAutonomyEnabled: true,
      enabledForPlayers: false,
      activeNppBillCount: 0,
      lastNppBillVotingEndsOnTurn: null,
      legTypes: [legType],
      insertSpy,
    });
    const ctx = makeCtx(db, [off1, off2, off3], nppMap);

    await processNppBillSponsorship(ctx);

    expect(insertSpy).toHaveBeenCalledTimes(1);
    const billArgs2 = insertSpy.mock.calls[0] as unknown as [Record<string, unknown>];
    const bill = billArgs2[0];
    // Should pick npp2 (sequentialId 1, lowest)
    expect((bill["sponsorId"] as any).toString()).toBe(npp2._id.toString());
  });
});

// ── Tests: V1.7 opposition rival bills ───────────────────────────────────────

describe("processNppBillSponsorship — opposition rival bills (V1.7)", () => {
  it("the opposition also sponsors a rival bill under a formed NPP government at v1", async () => {
    const govNpp = makeNpp({ sequentialId: 1, party: "1", name: "Gov NPP" });
    const oppNpp = makeNpp({ sequentialId: 2, party: "2", name: "Opp NPP" });
    // Governing party "1" holds the lower-chamber majority; "2" is the opposition.
    const govOfficial = makeOfficial(govNpp._id, "US", "house", "1", 12);
    const oppOfficial = makeOfficial(oppNpp._id, "US", "house", "2", 9);
    const nppMap = new Map([
      [govNpp._id.toString(), govNpp],
      [oppNpp._id.toString(), oppNpp],
    ]);

    const insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() }));
    const { db } = makeMockDb({
      nppAutonomyEnabled: true,
      nppAutonomyLevel: "v1",
      enabledForPlayers: false,
      legTypes: [makeLegType("eco", "economic_growth"), makeLegType("fisc", "fiscal")],
      insertSpy,
      governmentFormation: {
        _id: "US",
        status: "formed",
        governingPartyId: "1",
        pmNppId: govNpp._id,
        governingAgenda: {
          items: [{ domain: "economic_growth", target: 65, direction: "raise", priority: 1 }],
          archetype: "technocrat",
          computedTurn: 100,
        },
      },
      // Live Chamber seats backing the opposition identification —
      // `loadGovernmentDirectives` tallies this instead of a stored
      // `governmentFormation.seatsByParty` cache.
      electedOfficials: [
        { officeType: "house", countryId: "US", party: "1", seatsHeld: 120 },
        { officeType: "house", countryId: "US", party: "2", seatsHeld: 90 },
      ],
    });
    const ctx = makeCtx(db, [govOfficial, oppOfficial], nppMap);

    const count = await processNppBillSponsorship(ctx);

    // Two bills introduced this turn: one from the government, one from the opposition.
    expect(count).toBe(2);
    expect(insertSpy).toHaveBeenCalledTimes(2);
    const sponsorIds = insertSpy.mock.calls.map((c) =>
      ((c as unknown as [Record<string, unknown>])[0]["sponsorId"] as ObjectId).toString()
    );
    expect(sponsorIds).toContain(govNpp._id.toString());
    expect(sponsorIds).toContain(oppNpp._id.toString());
  });

  it("identifies the opposition from a live seat tally, ignoring a stale gov.seatsByParty", async () => {
    // Regression for the stale-cache defect: `governmentFormations.seatsByParty`
    // is a write-triggered cache that can drift arbitrarily far from the real
    // chamber (measured in the field: BR/NG summed to 0 against real totals of
    // 513/360). Here the stored doc names a fictitious party "3" as dominant —
    // a party with no seated officials at all. If that stale field were read,
    // `identifyOppositionParty` would pick "3", `pickSponsorOfficial` would
    // find no candidate for it, and the opposition rival bill would silently
    // never be sponsored. The live tally (from electedOfficials) correctly
    // names party "2" — the only real non-governing party — as the opposition.
    const govNpp = makeNpp({ sequentialId: 1, party: "1", name: "Gov NPP" });
    const oppNpp = makeNpp({ sequentialId: 2, party: "2", name: "Opp NPP" });
    const govOfficial = makeOfficial(govNpp._id, "US", "house", "1", 12);
    const oppOfficial = makeOfficial(oppNpp._id, "US", "house", "2", 9);
    const nppMap = new Map([
      [govNpp._id.toString(), govNpp],
      [oppNpp._id.toString(), oppNpp],
    ]);

    const insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() }));
    const { db } = makeMockDb({
      nppAutonomyEnabled: true,
      nppAutonomyLevel: "v1",
      enabledForPlayers: false,
      legTypes: [makeLegType("eco", "economic_growth"), makeLegType("fisc", "fiscal")],
      insertSpy,
      governmentFormation: {
        _id: "US",
        status: "formed",
        governingPartyId: "1",
        // Stale cache: a fictitious party "3" (no seated officials) appears
        // dominant, and the real opposition party "2" is invisible.
        seatsByParty: { "1": 5, "3": 999 },
        pmNppId: govNpp._id,
      },
      // Live truth: only parties "1" (governing) and "2" hold seats.
      electedOfficials: [
        { officeType: "house", countryId: "US", party: "1", seatsHeld: 120 },
        { officeType: "house", countryId: "US", party: "2", seatsHeld: 90 },
      ],
    });
    const ctx = makeCtx(db, [govOfficial, oppOfficial], nppMap);

    const count = await processNppBillSponsorship(ctx);

    expect(count).toBe(2);
    const sponsorIds = insertSpy.mock.calls.map((c) =>
      ((c as unknown as [Record<string, unknown>])[0]["sponsorId"] as ObjectId).toString()
    );
    expect(sponsorIds).toContain(oppNpp._id.toString());
  });

  it("no opposition bill below v1 (only the governing party sponsors)", async () => {
    const govNpp = makeNpp({ sequentialId: 1, party: "1" });
    const oppNpp = makeNpp({ sequentialId: 2, party: "2" });
    const govOfficial = makeOfficial(govNpp._id, "US", "house", "1", 12);
    const oppOfficial = makeOfficial(oppNpp._id, "US", "house", "2", 9);
    const nppMap = new Map([
      [govNpp._id.toString(), govNpp],
      [oppNpp._id.toString(), oppNpp],
    ]);

    const insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() }));
    const { db } = makeMockDb({
      nppAutonomyEnabled: true, // v0 (no explicit level)
      legTypes: [makeLegType("eco", "economic_growth")],
      insertSpy,
      governmentFormation: {
        _id: "US",
        status: "formed",
        governingPartyId: "1",
        seatsByParty: { "1": 120, "2": 90 },
      },
    });
    const ctx = makeCtx(db, [govOfficial, oppOfficial], nppMap);

    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Tests: buildConditionsSignal (weak + strong domains) ────────────────────

describe("buildConditionsSignal", () => {
  it("still reads weak domains from a raw stateMetrics doc", () => {
    const signal = buildConditionsSignal({
      inflationRate: 0,
      stateMetrics: { healthcare: { healthcareAccess: 16 } }, // < 40 → weak
    });
    expect(signal.weakDomains?.healthcare).toBeCloseTo(0.6, 5); // (40-16)/40
  });

  it("reads strong domains the mirror way - a comfortably high metric (>= 75)", () => {
    const signal = buildConditionsSignal({
      inflationRate: 0,
      stateMetrics: { healthcare: { healthcareAccess: 100 } },
    });
    expect(signal.strongDomains?.healthcare).toBeCloseTo(1.0, 5); // (100-75)/(100-75)
    expect(signal.weakDomains?.healthcare).toBeUndefined();
  });

  it("the 40-75 band is inert - neither weak nor strong", () => {
    const signal = buildConditionsSignal({
      inflationRate: 0,
      stateMetrics: { healthcare: { healthcareAccess: 55 } },
    });
    expect(signal.weakDomains?.healthcare).toBeUndefined();
    expect(signal.strongDomains?.healthcare).toBeUndefined();
  });

  it("supports the raw-number metric shape as well as {value}", () => {
    const signal = buildConditionsSignal({
      inflationRate: 0,
      stateMetrics: { healthcare: { healthcareAccess: { value: 90 } } },
    });
    expect(signal.strongDomains?.healthcare).toBeCloseTo(0.6, 5); // (90-75)/25
  });
});

// ── Tests: selectNppBill ─────────────────────────────────────────────────────

describe("selectNppBill", () => {
  const npp = makeNpp({ policies: { economic: 4, social: 0 } }); // strongly right-economic

  it("picks the legislation type with highest hybrid score", () => {
    const rightFiscal = makeLegType("right_fiscal", "fiscal", 3, 0); // aligns with right NPP + inflation urgent
    const leftSocial = makeLegType("left_social", "social", -3, -2); // misaligns with right NPP

    const signal = buildConditionsSignal({ inflationRate: 7.0, stateMetrics: null });
    const result = selectNppBill([rightFiscal, leftSocial], npp, signal);

    expect(result).not.toBeNull();
    expect(result!.legType._id).toBe("right_fiscal");
  });

  it("deterministic tie-break: lower _id wins when scores are equal", () => {
    // Two types with identical domain and equivalent vectors — tie-break by _id
    const typeA = makeLegType("zzz_type", "social", 0, 0);
    const typeB = makeLegType("aaa_type", "social", 0, 0);

    const signal = buildConditionsSignal({ inflationRate: 2.0, stateMetrics: null });
    const result = selectNppBill([typeA, typeB], npp, signal);

    expect(result).not.toBeNull();
    expect(result!.legType._id).toBe("aaa_type"); // lower string wins
  });

  it("returns null for empty candidate set", () => {
    const signal = buildConditionsSignal({ inflationRate: 3.0, stateMetrics: null });
    const result = selectNppBill([], npp, signal);
    expect(result).toBeNull();
  });

  it("picks urgency-directed option when inflation is hot in a fiscal domain", () => {
    const fiscalType = makeLegType("fiscal_u", "fiscal", 2, 0);
    // Hot inflation → prefer effectDirection = 1 (tighten)
    const signal = buildConditionsSignal({ inflationRate: 8.0, stateMetrics: null });
    const result = selectNppBill([fiscalType], npp, signal);

    expect(result).not.toBeNull();
    expect(result!.option.effectDirection).toBe(1);
  });
});
