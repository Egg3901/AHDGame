import { describe, it, expect } from "vitest";
import { BASE_TURN_PHASE_NAMES } from "@/simulation/phases/turnPhaseNames";
import {
  ECONOMY_ONLY_PHASES,
  ELECTIONS_SKIP_PHASES,
  MACRO_ONLY_PHASES,
  getSimTurnPhasePredicate,
} from "@/simulation/phases/simTurnProfiles";

describe("simTurnProfiles — elections-only turn-phase gate", () => {
  it("full / undefined / null profile applies NO filtering (prod default)", () => {
    expect(getSimTurnPhasePredicate("full")).toBeUndefined();
    expect(getSimTurnPhasePredicate(undefined)).toBeUndefined();
    expect(getSimTurnPhasePredicate(null)).toBeUndefined();
  });

  it("elections-only skips the economy phases", () => {
    const pred = getSimTurnPhasePredicate("elections-only");
    expect(pred).toBeDefined();
    for (const econ of [
      "corporationTurn", // the known hotspot
      "nppUnionBehavior",
      "economicModel",
      "forexTurn",
      "bondTurn",
      "commodityPrices",
      "metricEngine",
      "ledgerReconcile",
      "wealthListSnapshot",
      "economicVitalSigns",
    ]) {
      expect(pred!(econ)).toBe(false);
    }
  });

  it("elections-only KEEPS every election / campaign / approval / turnout phase", () => {
    const pred = getSimTurnPhasePredicate("elections-only")!;
    for (const keep of [
      // votes over time + resolution
      "voteAccumulation",
      "primaryResolution",
      "primarySnapshots",
      "electionTimers",
      "electionResolution",
      "perpetualElections",
      "presidentialSuccession",
      // campaign / strategy / money
      "campaignTurn",
      "generateChallengers", // single-seat contestation must run in elections-only
      "nppBehavior",
      "nppActionProcessing",
      "fundGeneration",
      "nppFundGeneration",
      // party + turnout + approval substrate that feeds vote share
      "partyGOTV",
      "statePartyElections",
      "supportDecay",
      "supportAccrual",
      "nationalMetrics",
      "approvalSnapshot",
      "archetypeApprovalDecay",
      "partyHistorySnapshot",
      "census",
      "demographicFlows",
    ]) {
      expect(pred(keep)).toBe(true);
    }
  });

  it("never skips the core vote-over-time / resolution phases", () => {
    for (const critical of [
      "voteAccumulation",
      "primaryResolution",
      "electionResolution",
      "primarySnapshots",
      "electionTimers",
      "campaignTurn",
    ]) {
      expect(ELECTIONS_SKIP_PHASES.has(critical)).toBe(false);
    }
  });

  it("every skip-list phase is a real turn-phase name (typo guard)", () => {
    // indexFunds is a real runtime phase (registry calls runPhase("indexFunds"))
    // but is not enumerated in BASE_TURN_PHASE_NAMES, so allow it explicitly.
    const known = new Set<string>([...BASE_TURN_PHASE_NAMES, "indexFunds"]);
    const unknown = [...ELECTIONS_SKIP_PHASES].filter((name) => !known.has(name));
    expect(unknown).toEqual([]);
  });

  it("skips NPP union behavior with the frozen union economy", () => {
    expect(BASE_TURN_PHASE_NAMES).toContain("nppUnionBehavior");
    expect(ELECTIONS_SKIP_PHASES.has("nppUnionBehavior")).toBe(true);
    expect(getSimTurnPhasePredicate("elections-only")!("nppUnionBehavior")).toBe(false);
  });
});

describe("simTurnProfiles: economy-only turn-phase gate", () => {
  it("keeps the macro and accounting phases", () => {
    const pred = getSimTurnPhasePredicate("economy-only")!;
    for (const phase of [
      "corporationTurn",
      "commodityPrices",
      "fiscalYear",
      "metricEngine",
      "economicModel",
      "inflationRecalc",
      "commandEconomy",
      "forexTurn",
      "indexFunds",
      "ledgerReconcile",
      "economicVitalSigns",
    ]) {
      expect(ECONOMY_ONLY_PHASES.has(phase)).toBe(true);
      expect(pred(phase)).toBe(true);
    }
  });

  it("freezes political and random-event phases", () => {
    const pred = getSimTurnPhasePredicate("economy-only")!;
    for (const phase of [
      "statePartyElections",
      "nppBillSponsorship",
      "campaignTurn",
      "playerRandomEvents",
      "ministerialOrders",
    ]) {
      expect(pred(phase)).toBe(false);
    }
  });
});

describe("simTurnProfiles: macro-only turn-phase gate", () => {
  it("keeps macro outcomes but freezes corporate strategy and ledgers", () => {
    const pred = getSimTurnPhasePredicate("macro-only")!;
    for (const phase of [
      "commodityPrices",
      "fiscalYear",
      "metricEngine",
      "economicModel",
      "inflationRecalc",
      "commandEconomy",
      "forexTurn",
    ]) {
      expect(MACRO_ONLY_PHASES.has(phase)).toBe(true);
      expect(pred(phase)).toBe(true);
    }
    for (const phase of ["corporationTurn", "campaignTurn", "ledgerReconcile"]) {
      expect(pred(phase)).toBe(false);
    }
  });
});
