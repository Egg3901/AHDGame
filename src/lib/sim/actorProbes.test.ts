import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { FOMC_COMMITTEE_COUNTRY_IDS, FOMC_TERM_TURNS } from "@/lib/db/types/centralBank";
import { computeIpoIssuance } from "@/lib/corporations/ipoIssuance";
import { getRoundedPublicMarketCap } from "@/lib/corporations/marketQuote";
import { CEO_INITIAL_SHARES } from "@/lib/constants/corporations";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { roundCurrency } from "@/lib/wealth/computeCharacterWealth";
import { UNCOVERED_PRESIDENTIAL_NOMINATION } from "./actorCoverage";
import { buildSyntheticActorPlan } from "./syntheticActors";
import {
  IPO_PROBE_FLOAT_PCT,
  IPO_PROBE_PRICE_PER_SHARE,
  PRIVATE_PROBE_FOUNDING_CAPITAL,
  PROBE_1953_NOW_ISO,
  PROBE_BASE_ACTIONS_PER_TURN,
  PROBE_FOUNDER_CASH,
  STATE_PARTY_PROBE_POSITIONS,
  probeCampaignsAndActions,
  syntheticCampaignActionsPerActor,
  probeCharacterWealth,
  probeCorpFounding,
  probeCountryOffices,
  probeCrisisDecisions,
  probeDdFinanceSurvey,
  probeFedChair1953,
  probeHouseholdWealth,
  probeOppositionResearch,
  probePresidentialNomination,
  probeStatePartyLeadership,
} from "./actorProbes";

const SEED = "probe-seed-7";

describe("probePresidentialNomination", () => {
  it("returns the exact uncovered result in pure NPP mode", () => {
    const result = probePresidentialNomination("pure-npp", SEED);
    expect(result.mechanicId).toBe("presidential-nomination");
    expect(result.result).toBe(UNCOVERED_PRESIDENTIAL_NOMINATION);
    expect(result.winnerCandidateId).toBeNull();
    expect(result.majorityThreshold).toBeNull();
  });

  it("resolves the real convention path with the synthetic leader winning", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probePresidentialNomination("synthetic", SEED);
    expect(result.winnerCandidateId).toBe(plan.actors[0].characterIdHex);
    expect(result.result).toContain(`nominated: ${plan.actors[0].characterIdHex}`);
    expect(result.majorityThreshold).toBeGreaterThan(0);
  });

  it("is deterministic by seed", () => {
    expect(probePresidentialNomination("synthetic", SEED)).toEqual(
      probePresidentialNomination("synthetic", SEED)
    );
    expect(probePresidentialNomination("synthetic", "other-seed").winnerCandidateId).not.toBe(
      probePresidentialNomination("synthetic", SEED).winnerCandidateId
    );
  });
});

describe("probeFedChair1953", () => {
  it("returns the exact uncovered result in pure NPP mode (vacant chair)", () => {
    const result = probeFedChair1953("pure-npp", SEED);
    expect(result.mechanicId).toBe("central-bank-chair-us");
    expect(result.result).toBe(UNCOVERED_PRESIDENTIAL_NOMINATION);
    expect(result.seated).toBeNull();
  });

  it("seats the 1953 US chair via the simulated presidential route", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probeFedChair1953("synthetic", SEED);
    expect(FOMC_COMMITTEE_COUNTRY_IDS.has("US")).toBe(true);
    expect(result.seated).toMatchObject({
      countryId: "US",
      seat: 1,
      chairCharacterIdHex: plan.actors[1].characterIdHex,
      nominatedByCharacterIdHex: plan.actors[0].characterIdHex,
      route: "simulated-presidential",
      committeeBank: true,
      termTurns: FOMC_TERM_TURNS,
    });
    expect(result.result).toContain(plan.actors[1].characterIdHex);
  });
});

describe("probeCountryOffices", () => {
  it("seats nothing in pure NPP mode", () => {
    const result = probeCountryOffices("pure-npp", SEED);
    expect(result.offices).toHaveLength(2);
    for (const office of result.offices) {
      expect(office.holderCharacterIdHex).toBeNull();
      expect(office.roles).toEqual([]);
    }
  });

  it("seats the plan's executive and minister with real role derivation", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probeCountryOffices("synthetic", SEED);
    const president = result.offices.find((o) => o.office === "president");
    const minister = result.offices.find((o) => o.office === "finance-minister");
    expect(president?.holderCharacterIdHex).toBe(plan.actors[0].characterIdHex);
    expect(president?.roles).toContain("headOfState");
    expect(minister?.holderCharacterIdHex).toBe(plan.actors[6].characterIdHex);
    expect(minister?.roles).toContain("any");
  });
});

describe("probeStatePartyLeadership", () => {
  it("stays pinned to every production office (drift guard without importing the shell)", () => {
    expect([...STATE_PARTY_PROBE_POSITIONS]).toEqual(["chair", "viceChair", "treasurer"]);
    const source = readFileSync(join(process.cwd(), "src/lib/statePartyElections.ts"), "utf8");
    const match = source.match(/ALL_POSITIONS[^=]*=\s*\[([\s\S]*?)\]/);
    expect(match, "ALL_POSITIONS declaration not found").toBeTruthy();
    for (const position of STATE_PARTY_PROBE_POSITIONS) {
      expect(match?.[1]).toContain(`"${position}"`);
    }
  });

  it("leaves every seat vacant in pure NPP mode", () => {
    const result = probeStatePartyLeadership("pure-npp", SEED);
    expect(result.result).toContain("no-candidate");
    for (const seat of result.seated) expect(seat.holderCharacterIdHex).toBeNull();
  });

  it("seats the synthetic member in every office", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probeStatePartyLeadership("synthetic", SEED);
    expect(result.seated.map((s) => s.position)).toEqual([...STATE_PARTY_PROBE_POSITIONS]);
    for (const seat of result.seated) {
      expect(seat.holderCharacterIdHex).toBe(plan.actors[2].characterIdHex);
    }
  });
});

describe("probeCampaignsAndActions", () => {
  it("reports zero campaigns and zero actions in pure NPP mode", () => {
    const result = probeCampaignsAndActions("pure-npp", SEED);
    expect(result.campaigns).toBe(0);
    expect(result.playerActions).toBe(0);
  });

  it("accrues the production-rule budget per synthetic campaigner, unspent", () => {
    // The seed default baseActionsPerTurn is 4 and an unendorsed player
    // candidate accrues exactly the baseline through the production rule.
    expect(PROBE_BASE_ACTIONS_PER_TURN).toBe(4);
    expect(syntheticCampaignActionsPerActor()).toBe(4);
    const result = probeCampaignsAndActions("synthetic", SEED);
    expect(result.campaigns).toBe(4);
    expect(result.playerActions).toBe(4 * syntheticCampaignActionsPerActor());
    expect(result.result).toContain("opposition-research flow driver");
  });
});

describe("probeOppositionResearch", () => {
  it("reports zero campaigns and zero actions in pure NPP mode", () => {
    const result = probeOppositionResearch("pure-npp", SEED);
    expect(result.mechanicId).toBe("campaigns-player-actions");
    expect(result.result).toBe("zero campaigns, zero player actions");
    expect(result.drainPerTurn).toBeNull();
    expect(result.starterFunds).toBeNull();
    expect(result.starterActions).toBeNull();
  });

  it("prices the starter drain and cost through the real rules", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const buyer = plan.actors.find((a) => a.role === "us-state-party-member") ?? plan.actors[0];
    const result = probeOppositionResearch("synthetic", SEED);
    // A starter-only tree drains the documented starter magnitude.
    expect(result.drainPerTurn).toBe(0.5);
    expect(result.starterFunds).toBeGreaterThan(0);
    expect(result.starterActions).toBeGreaterThan(0);
    expect(result.result).toContain(buyer.characterIdHex);
    expect(result.result).toContain("opposition-research flow driver");
  });

  it("is deterministic by seed", () => {
    expect(probeOppositionResearch("synthetic", SEED)).toEqual(
      probeOppositionResearch("synthetic", SEED)
    );
    expect(probeOppositionResearch("synthetic", "other-seed").result).not.toBe(
      probeOppositionResearch("synthetic", SEED).result
    );
  });
});

describe("probeCrisisDecisions", () => {
  it("refuses the head-of-state gate with no character (empty resolution path)", () => {
    const result = probeCrisisDecisions("pure-npp", SEED);
    expect(result.canDecide).toBe(false);
    expect(result.resolutionPath).toEqual([]);
    expect(result.chosenOptionId).toBeNull();
    expect(result.result).toContain("empty resolution path");
  });

  it("records a chosen option through the real authorization gate", () => {
    const result = probeCrisisDecisions("synthetic", SEED);
    expect(result.canDecide).toBe(true);
    expect(result.chosenOptionId).toBe("probe-stabilize");
    expect(result.resolutionPath).toEqual(["probe-stabilize"]);
  });
});

describe("probeCharacterWealth and probeHouseholdWealth", () => {
  it("observes nothing in pure NPP mode (the vital-signs shape from the issue)", () => {
    const portfolios = probeCharacterWealth("pure-npp", SEED);
    expect(portfolios.portfolios).toEqual([]);
    const households = probeHouseholdWealth("pure-npp", SEED);
    expect(households).toMatchObject({
      households: 0,
      median: null,
      gini: null,
      topTenShare: null,
    });
  });

  it("revalues the IPO holding while the unlisted private holding quotes at zero", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probeCharacterWealth("synthetic", SEED);
    expect(result.portfolios).toHaveLength(2);
    const [priv, ipo] = result.portfolios;
    expect(priv.characterIdHex).toBe(plan.actors[3].characterIdHex);
    expect(ipo.characterIdHex).toBe(plan.actors[4].characterIdHex);
    expect(priv.cashValue).toBe(PROBE_FOUNDER_CASH);
    expect(priv.stockValue).toBe(0);
    expect(priv.totalWealth).toBe(roundCurrency(PROBE_FOUNDER_CASH));
    expect(ipo.stockValue).toBeGreaterThan(0);
    expect(ipo.totalWealth).toBe(roundCurrency(PROBE_FOUNDER_CASH + ipo.stockValue));
    expect(ipo.totalWealth).toBeGreaterThan(priv.totalWealth);
  });

  it("moves the IPO portfolio with the observed quote", () => {
    const low = probeCharacterWealth("synthetic", SEED, 10).portfolios[1].totalWealth;
    const high = probeCharacterWealth("synthetic", SEED, 20).portfolios[1].totalWealth;
    expect(high).toBeGreaterThan(low);
  });

  it("aggregates synthetic households into bounded median/Gini/top-ten metrics", () => {
    const result = probeHouseholdWealth("synthetic", SEED);
    expect(result.households).toBe(2);
    expect(result.median).not.toBeNull();
    expect(result.gini).not.toBeNull();
    expect(result.topTenShare).not.toBeNull();
    const totals = probeCharacterWealth("synthetic", SEED).portfolios.map((p) => p.totalWealth);
    const [lo, hi] = [...totals].sort((a, b) => a - b);
    expect(result.median as number).toBeGreaterThanOrEqual(lo);
    expect(result.median as number).toBeLessThanOrEqual(hi);
    expect(result.gini as number).toBeGreaterThanOrEqual(0);
    expect(result.gini as number).toBeLessThanOrEqual(1);
    expect(result.topTenShare as number).toBeGreaterThan(0);
    expect(result.topTenShare as number).toBeLessThanOrEqual(1);
  });
});

describe("probeCorpFounding", () => {
  it("finds no player corporation at any checkpoint in pure NPP mode", () => {
    for (const kind of ["private", "ipo"] as const) {
      const result = probeCorpFounding("pure-npp", kind, SEED);
      expect(result.founderCharacterIdHex).toBeNull();
      expect(result.checkpoints).toEqual([]);
      expect(result.result).toContain("no player corporation exists");
    }
  });

  it("captures the private founding unlisted at all three checkpoints", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probeCorpFounding("synthetic", "private", SEED);
    expect(result.founderCharacterIdHex).toBe(plan.actors[3].characterIdHex);
    expect(result.checkpoints.map((c) => c.checkpoint)).toEqual([
      "pre-turn",
      "first-recompute",
      "second-recompute",
    ]);
    for (const checkpoint of result.checkpoints) {
      expect(checkpoint.foundingCapital).toBe(PRIVATE_PROBE_FOUNDING_CAPITAL);
      expect(checkpoint.issuedShares).toBe(CEO_INITIAL_SHARES);
      expect(checkpoint.placedShares).toBe(0);
      expect(checkpoint.issuanceProceeds).toBe(0);
      expect(checkpoint.marketCap).toBeNull();
      expect(checkpoint.priceBook).toBeNull();
      expect(checkpoint.bookValue).toBe(roundCurrency(PRIVATE_PROBE_FOUNDING_CAPITAL));
    }
  });

  it("runs the IPO leg through the real issuance and quote math", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const expected = computeIpoIssuance({
      existingShares: CEO_INITIAL_SHARES,
      pricePerShare: IPO_PROBE_PRICE_PER_SHARE,
      floatPct: IPO_PROBE_FLOAT_PCT,
    });
    const result = probeCorpFounding("synthetic", "ipo", SEED);
    expect(result.founderCharacterIdHex).toBe(plan.actors[4].characterIdHex);
    expect(result.checkpoints).toHaveLength(3);
    for (const checkpoint of result.checkpoints) {
      expect(checkpoint.placedShares).toBe(expected.newShares);
      expect(checkpoint.issuanceProceeds).toBe(expected.proceeds);
      expect(checkpoint.issuedShares).toBe(expected.totalSharesAfter);
      expect(checkpoint.marketCap).not.toBeNull();
      // Internal consistency: price/book recomputed from the checkpoint's own
      // market cap and book value, independent of the probe's code path.
      expect(checkpoint.priceBook).toBe(
        roundCurrency((checkpoint.marketCap as number) / checkpoint.bookValue)
      );
    }
    const [pre, first, second] = result.checkpoints;
    expect(pre.marketCap).toBe(
      getRoundedPublicMarketCap({ sharePrice: 10 }, expected.totalSharesAfter)
    );
    expect(first.marketCap).toBe(
      getRoundedPublicMarketCap({ sharePrice: 10.5 }, expected.totalSharesAfter)
    );
    expect(second.marketCap).toBe(
      getRoundedPublicMarketCap({ sharePrice: 11 }, expected.totalSharesAfter)
    );
    expect(second.bookValue).toBe(pre.bookValue);
  });

  it("accepts observed live-run quotes and retained earnings", () => {
    const result = probeCorpFounding("synthetic", "ipo", SEED, {
      quotes: [12, 12, 12],
      retained: [0, 1000, 2000],
    });
    const [pre, first, second] = result.checkpoints;
    expect(first.bookValue).toBe(roundCurrency(pre.bookValue + 1000));
    expect(second.bookValue).toBe(roundCurrency(pre.bookValue + 2000));
    expect(pre.marketCap).toBe(
      getRoundedPublicMarketCap({ sharePrice: 12 }, result.checkpoints[0].issuedShares)
    );
  });
});

describe("probeDdFinanceSurvey", () => {
  it("marks the survey unreachable in pure NPP mode", () => {
    const result = probeDdFinanceSurvey("pure-npp", SEED);
    expect(result.mechanicId).toBe("dd-finance-minister-survey");
    expect(result.ministerCharacterIdHex).toBeNull();
    expect(result.seatMatchesIssuerGate).toBe(false);
    expect(result.seatPositionId).toBe(COUNTRY_CONFIGS.DD?.financeMinisterCabinetId);
  });

  it("seats the minister under the gate's own lookup key", () => {
    const plan = buildSyntheticActorPlan(SEED);
    const result = probeDdFinanceSurvey("synthetic", SEED);
    expect(result.ministerCharacterIdHex).toBe(plan.actors[6].characterIdHex);
    expect(result.seatPositionId).toBe(COUNTRY_CONFIGS.DD?.financeMinisterCabinetId);
    expect(result.seatMatchesIssuerGate).toBe(true);
  });
});

describe("probe determinism", () => {
  it("pins the 1953 timestamp every probe passes to defaulted rules", () => {
    expect(PROBE_1953_NOW_ISO).toBe("1953-01-01T00:00:00.000Z");
  });
});
