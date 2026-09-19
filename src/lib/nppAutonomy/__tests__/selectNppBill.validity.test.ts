/**
 * selectNppBill validity filtering (#1995).
 *
 * Autonomous selection must exclude the country's already-enacted rung and any
 * country/type/option combination already present in an active bill, falling
 * through to the next valid option or legislation type instead of abandoning
 * the sponsorship attempt. No reaffirmation mechanic exists in the proposal
 * path, so the enacted rung is excluded unconditionally.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { LegislationType, LegislationPolicyOption, NPP } from "@/lib/db/types";
import type { GoverningAgendaItem } from "../governingAgenda";
import { selectNppBill, activeProposalKey, type ConditionsSignal } from "../selectNppBill";
import { processNppBillSponsorship } from "../../turn/npp/billSponsorship";
import type { NPPContext } from "../../turn/npp/context";
import type { ElectedOfficial } from "../../db/types/officials";

// ── Fixtures ────────────────────────────────────────────────────────────────

function option(over: Partial<LegislationPolicyOption> & { id: string }): LegislationPolicyOption {
  return {
    name: over.id,
    stance: "center",
    effectDirection: 1,
    economic: 0,
    social: 0,
    ...over,
  } as LegislationPolicyOption;
}

function legType(
  id: string,
  policyDomain: string,
  options: LegislationPolicyOption[]
): LegislationType {
  return {
    _id: id,
    name: `Bill ${id}`,
    description: "",
    policyDomain,
    subCategory: "",
    positions: [],
    policyOptions: options,
  } as unknown as LegislationType;
}

const rightNpp = { policies: { economic: 5, social: 0 } } as NPP;
const noUrgency: ConditionsSignal = { weakDomains: {} };
const enacted = (typeId: string, optionId: string) => new Map<string, string>([[typeId, optionId]]);
const dupKeys = (typeId: string, optionId: string) =>
  new Set<string>([activeProposalKey(typeId, optionId)]);

// ── Ordinary platform selection ─────────────────────────────────────────────

describe("selectNppBill validity — ordinary platform selection", () => {
  const ladder = legType("a", "education", [
    option({ id: "a_best", economic: 5, effectDirection: 1 }),
    option({ id: "a_next", economic: 2, effectDirection: 1 }),
    option({ id: "a_bad", economic: -5, effectDirection: -1 }),
  ]);

  it("skips the enacted rung and takes the next-best option", () => {
    const sel = selectNppBill(
      [ladder],
      rightNpp,
      noUrgency,
      undefined,
      undefined,
      enacted("a", "a_best")
    );
    expect(sel?.option.id).toBe("a_next");
  });

  it("old-code control: without the enacted map the invalid best still wins", () => {
    const sel = selectNppBill([ladder], rightNpp, noUrgency);
    expect(sel?.option.id).toBe("a_best");
  });

  it("a type whose every option is invalid yields to the next valid type", () => {
    const spent = legType("a", "education", [
      option({ id: "a_best", economic: 5, effectDirection: 1 }),
    ]);
    const fresh = legType("b", "education", [
      option({ id: "b_ok", economic: 2, effectDirection: 1 }),
    ]);
    const sel = selectNppBill(
      [spent, fresh],
      rightNpp,
      noUrgency,
      undefined,
      undefined,
      enacted("a", "a_best")
    );
    expect(sel?.legType._id).toBe("b");
    expect(sel?.option.id).toBe("b_ok");
  });

  it("a single-option ladder on the enacted rung selects nothing (no reaffirmation)", () => {
    const spent = legType("a", "education", [
      option({ id: "a_best", economic: 5, effectDirection: 1 }),
    ]);
    const sel = selectNppBill(
      [spent],
      rightNpp,
      noUrgency,
      undefined,
      undefined,
      enacted("a", "a_best")
    );
    expect(sel).toBeNull();
  });
});

// ── Active-duplicate filtering ──────────────────────────────────────────────

describe("selectNppBill validity — active-duplicate filtering", () => {
  const ladder = legType("a", "education", [
    option({ id: "a_best", economic: 5, effectDirection: 1 }),
    option({ id: "a_next", economic: 2, effectDirection: 1 }),
  ]);

  it("excludes the in-flight combo but keeps a sibling option on the same type", () => {
    const sel = selectNppBill(
      [ladder],
      rightNpp,
      noUrgency,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        activeProposalKeys: dupKeys("a", "a_best"),
      }
    );
    expect(sel?.legType._id).toBe("a");
    expect(sel?.option.id).toBe("a_next");
  });

  it("old-code control: without the active set the duplicate still wins", () => {
    const sel = selectNppBill([ladder], rightNpp, noUrgency);
    expect(sel?.option.id).toBe("a_best");
  });

  it("the same option id on a different type is not a duplicate", () => {
    const typeA = legType("a", "education", [
      option({ id: "shared", economic: 5, effectDirection: 1 }),
    ]);
    const typeB = legType("b", "education", [
      option({ id: "shared", economic: -5, effectDirection: 1 }),
      option({ id: "b_other", economic: 5, effectDirection: 1 }),
    ]);
    // Only b:shared is in flight: a still wins on platform fit and keeps it.
    const sel = selectNppBill(
      [typeA, typeB],
      rightNpp,
      noUrgency,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        activeProposalKeys: dupKeys("b", "shared"),
      }
    );
    expect(sel?.legType._id).toBe("a");
    expect(sel?.option.id).toBe("shared");
    // And b itself falls through to its next valid option.
    const selB = selectNppBill(
      [typeB],
      rightNpp,
      noUrgency,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        activeProposalKeys: dupKeys("b", "shared"),
      }
    );
    expect(selB?.option.id).toBe("b_other");
  });
});

// ── Agenda, fiscal, opposition, V5 goal paths ───────────────────────────────

describe("selectNppBill validity — agenda / fiscal / opposition / goal paths", () => {
  it("agenda-directed selection stays on-direction with the next valid option", () => {
    const ladder = legType("a", "healthcare", [
      option({ id: "a_raise_best", economic: 5, effectDirection: 1 }),
      option({ id: "a_raise_next", economic: 2, effectDirection: 1 }),
      option({ id: "a_lower", economic: 5, effectDirection: -1 }),
    ]);
    const agenda: GoverningAgendaItem[] = [
      { domain: "healthcare", target: 65, direction: "raise", priority: 0.9 },
    ];
    const sel = selectNppBill(
      [ladder],
      rightNpp,
      noUrgency,
      agenda,
      undefined,
      enacted("a", "a_raise_best")
    );
    expect(sel?.option.id).toBe("a_raise_next");
    expect(sel?.option.effectDirection).toBe(1);
  });

  it("fiscal-directed selection skips enacted and duplicate options", () => {
    const ladder = legType("t", "tax", [
      option({ id: "t_best", economic: 5, effectDirection: 1 }),
      option({ id: "t_dup", economic: 4, effectDirection: 1 }),
      option({ id: "t_ok", economic: 3, effectDirection: 1 }),
      option({ id: "t_cut", economic: 5, effectDirection: -1 }),
    ]);
    const sel = selectNppBill(
      [ladder],
      rightNpp,
      noUrgency,
      undefined,
      { direction: 1, intensity: 0.8 },
      enacted("t", "t_best"),
      undefined,
      { activeProposalKeys: dupKeys("t", "t_dup") }
    );
    expect(sel?.option.id).toBe("t_ok");
    expect(sel?.option.effectDirection).toBe(1);
  });

  it("opposition counter-agenda obeys the same validity filter", () => {
    const leftNpp = { policies: { economic: -5, social: 0 } } as NPP;
    const ladder = legType("a", "healthcare", [
      option({ id: "l_best", economic: -5, effectDirection: -1 }),
      option({ id: "l_next", economic: -2, effectDirection: -1 }),
      option({ id: "r_flip", economic: -5, effectDirection: 1 }),
    ]);
    const counterAgenda: GoverningAgendaItem[] = [
      { domain: "healthcare", target: 30, direction: "lower", priority: 0.8 },
    ];
    const sel = selectNppBill(
      [ladder],
      leftNpp,
      noUrgency,
      counterAgenda,
      undefined,
      enacted("a", "l_best")
    );
    expect(sel?.option.id).toBe("l_next");
    expect(sel?.option.effectDirection).toBe(-1);
  });

  it("V5 goal-biased selection keeps the goal type but takes a valid option", () => {
    const health = legType("h", "healthcare", [
      option({ id: "h_best", economic: 5, effectDirection: 1 }),
      option({ id: "h_ok", economic: 2, effectDirection: 1 }),
    ]);
    const env = legType("e", "environment", [option({ id: "e_best", economic: 5 })]);
    const agenda: GoverningAgendaItem[] = [
      { domain: "healthcare", target: 65, direction: "raise", priority: 0.9 },
      { domain: "environment", target: 60, direction: "raise", priority: 0.5 },
    ];
    const sel = selectNppBill(
      [health, env],
      rightNpp,
      noUrgency,
      agenda,
      undefined,
      enacted("h", "h_best"),
      undefined,
      { goalDomains: new Set(["healthcare"]) }
    );
    expect(sel?.legType._id).toBe("h");
    expect(sel?.option.id).toBe("h_ok");
  });
});

// ── Fiscal restraint ────────────────────────────────────────────────────────

describe("selectNppBill validity — fiscal restraint", () => {
  const ladder = legType("h", "healthcare", [
    option({ id: "r1", economic: 0, effectDirection: -1, gdpCostFraction: 0.1 }),
    option({ id: "r2", economic: 0, effectDirection: -1, gdpCostFraction: 0.2 }),
    option({ id: "r3", economic: 0, effectDirection: -1, gdpCostFraction: 0.3 }),
    option({ id: "r4", economic: 0, effectDirection: -1, gdpCostFraction: 0.4 }),
  ]);
  const austerity = { direction: 1 as const, intensity: 0 };

  it("steps down past an active-duplicate restraint target, never up", () => {
    // 4 rungs, intensity 0 → interpolated target is r3 (index 2 of 0..3).
    const sel = selectNppBill(
      [ladder],
      rightNpp,
      noUrgency,
      undefined,
      austerity,
      enacted("h", "r4"),
      undefined,
      { activeProposalKeys: dupKeys("h", "r3") }
    );
    expect(sel?.option.id).toBe("r2");
  });

  it("restraint hold is preserved: enacted at/below target sponsors nothing", () => {
    const sel = selectNppBill(
      [ladder],
      rightNpp,
      noUrgency,
      undefined,
      austerity,
      enacted("h", "r2")
    );
    expect(sel).toBeNull();
  });
});

// ── Sponsorship-level: loader, caps, cooldowns ─────────────────────────────

function makeNpp(overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(),
    name: "Test NPP",
    party: "1",
    homeState: "federal",
    politicalInfluence: 50,
    favorability: 50,
    policies: { economic: 2, social: 0 },
    currentOffice: null,
    personality: { loyalty: 50, ambition: 50, stubbornness: 50 },
    sequentialId: 1,
    retiredAt: null,
    generatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as NPP;
}

function makeOfficial(nppId: ObjectId): ElectedOfficial {
  return {
    _id: new ObjectId(),
    countryId: "US",
    officeType: "house",
    party: "1",
    characterId: null,
    isNPP: true,
    nppId,
    seatsHeld: 10,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ElectedOfficial;
}

function makeMockDb(opts: {
  activeNppBillCount?: number;
  lastNppBillVotingEndsOnTurn?: number | null;
  billsEntries?: Array<Record<string, unknown>>;
  legTypes?: LegislationType[];
  insertSpy?: ReturnType<typeof vi.fn>;
}) {
  const {
    activeNppBillCount = 0,
    lastNppBillVotingEndsOnTurn = null,
    billsEntries = [],
    legTypes = [],
    insertSpy = vi.fn(async () => ({ insertedId: new ObjectId() })),
  } = opts;
  const db = {
    collection: (name: string) => {
      if (name === "gameState") {
        return { findOne: async () => ({ nppAutonomyEnabled: true, currentTurn: 100 }) };
      }
      if (name === "governmentFormations") {
        return { findOne: async () => null };
      }
      if (name === "countryGameStates") {
        return { findOne: async () => ({ enabledForPlayers: false }) };
      }
      if (name === "bills") {
        return {
          countDocuments: async () => activeNppBillCount,
          findOne: async () =>
            lastNppBillVotingEndsOnTurn !== null
              ? { votingEndsOnTurn: lastNppBillVotingEndsOnTurn }
              : null,
          find: () => ({ toArray: async () => billsEntries }),
          insertOne: insertSpy,
        };
      }
      if (name === "legislationTypes") {
        return {
          find: () => ({ toArray: async () => legTypes }),
          findOne: async (filter: { _id?: string }) =>
            legTypes.find((t) => t._id === filter?._id) ?? null,
        };
      }
      if (name === "countryState") {
        return {
          findOne: async () => ({
            _id: "US",
            countryId: "US",
            governmentType: "presidential",
            rulingPartyId: null,
          }),
        };
      }
      if (name === "statePolicies") {
        return { find: () => ({ toArray: async () => [] }) };
      }
      if (name === "enactedLaws") {
        return { find: () => ({ sort: () => ({ toArray: async () => [] }) }) };
      }
      if (name === "federalBudget") {
        return { findOne: async () => ({ economicFactors: { inflationRate: 2.0 } }) };
      }
      return {
        findOne: async () => null,
        find: () => ({ toArray: async () => [] }),
        countDocuments: async () => 0,
        insertOne: vi.fn(async () => ({ insertedId: new ObjectId() })),
      };
    },
  } as unknown as import("mongodb").Db;
  return { db, insertSpy };
}

function makeCtx(db: import("mongodb").Db, officials: ElectedOfficial[], nppMap: Map<string, NPP>) {
  return {
    db,
    now: new Date(),
    allNPPs: [...nppMap.values()],
    nppMap,
    openPrimaries: [],
    nppCandidacies: new Set(),
    candidatesByElection: new Map(),
    nppOfficials: officials,
    officialsByNPP: new Map(),
    activeBills: [],
    billWhips: new Map(),
    activeStateBills: [],
    stateBillWhips: new Map(),
    statePartyOrgs: new Map(),
    partyByCompositeKey: new Map(),
    partyCountries: new Map(),
    nppElectionEligiblePartyKeys: new Set(),
    legislationTypeMap: new Map(),
    stateDemographicsMap: new Map(),
    statesById: new Map(),
    currentTurn: 100,
  } as unknown as NPPContext;
}

describe("processNppBillSponsorship validity — active-duplicate steering, caps, cooldowns", () => {
  const typeA = legType("type_a", "economic_growth", [
    option({ id: "a_best", economic: 2, effectDirection: 1 }),
    option({ id: "a_ok", economic: 0, effectDirection: 1 }),
  ]);
  const typeB = legType("type_b", "economic_growth", [
    option({ id: "b_1", economic: -2, effectDirection: 1 }),
  ]);

  function setup(
    billsEntries: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {}
  ) {
    const npp = makeNpp();
    const official = makeOfficial(npp._id as ObjectId);
    const nppMap = new Map([[(npp._id as ObjectId).toString(), npp]]);
    const insertSpy = vi.fn(async (_bill: Record<string, unknown>) => ({
      insertedId: new ObjectId(),
    }));
    const { db } = makeMockDb({
      legTypes: [typeA, typeB],
      billsEntries,
      insertSpy,
      ...extra,
    });
    return { ctx: makeCtx(db, [official], nppMap), insertSpy };
  }

  it("steers around an in-flight type/option combo to the next valid option", async () => {
    const { ctx, insertSpy } = setup([
      {
        legislationTypeId: "unrelated_type",
        votingEndsOnTurn: 50,
        provisions: [{ legislationTypeId: "type_a", policyOptionId: "a_best" }],
      },
    ]);
    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const bill = insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(JSON.stringify(bill["provisions"])).toContain("a_ok");
    expect(JSON.stringify(bill["provisions"])).not.toContain("a_best");
  });

  it("active-bill cap still throttles even with a valid candidate available", async () => {
    const { ctx, insertSpy } = setup([], { activeNppBillCount: 2 });
    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("sponsor cooldown still throttles even with a valid candidate available", async () => {
    // votingEnds 119 → proposal turn 95 → gap 5 < 12-turn cooldown.
    const { ctx, insertSpy } = setup([], { lastNppBillVotingEndsOnTurn: 119 });
    const count = await processNppBillSponsorship(ctx);
    expect(count).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
