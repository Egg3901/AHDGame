import {
  BARGAINING_ESCALATION_SUPPORT,
  OVERTIME_BAN_OUTPUT_FACTOR,
  buildBargainingMandate,
  laborTightnessFromUnemployment,
  lawSupportFromBias,
} from "@/lib/unions/bargaining";
import { STRIKE_REVENUE_THROTTLE } from "@/lib/labour/strikes";
import { strikeCallCost } from "@/lib/unions/unionEconomy";

export interface IndustrialRelationsBalanceScenario {
  name: string;
  workers: number;
  unionization: number;
  wageLevel: number;
  workerExpectationIndex: number;
  /** State cost-of-living index; 100 is neutral. */
  costOfLivingIndex?: number;
  unemploymentRate: number;
  unionLawBias: number;
  treasury: number;
  organizedLocals: number;
}

export interface IndustrialRelationsBalanceResult {
  name: string;
  support: number;
  leverage: number;
  strikeFundRunway: number;
  canOvertimeBan: boolean;
  canSelectiveStrike: boolean;
  canIndustryStrike: boolean;
  selectiveStrikeCost: number;
  industryStrikeCost: number;
  overtimeBanOutputLossPercent: number;
  selectiveStrikeScopeOutputLossPercent: number;
  industryStrikeOutputLossPercent: number;
}

export const INDUSTRIAL_RELATIONS_BALANCE_SCENARIOS: readonly IndustrialRelationsBalanceScenario[] =
  [
    {
      name: "weak fragmented local",
      workers: 1000,
      unionization: 15,
      wageLevel: 1,
      workerExpectationIndex: 1,
      unemploymentRate: 12,
      unionLawBias: -30,
      treasury: 400,
      organizedLocals: 1,
    },
    {
      name: "viable bargaining union",
      workers: 3000,
      unionization: 45,
      wageLevel: 1,
      workerExpectationIndex: 1.03,
      unemploymentRate: 6,
      unionLawBias: 0,
      treasury: 2400,
      organizedLocals: 4,
    },
    {
      name: "strong tight-market union",
      workers: 8000,
      unionization: 75,
      wageLevel: 1,
      workerExpectationIndex: 1.1,
      unemploymentRate: 3,
      unionLawBias: 30,
      treasury: 8000,
      organizedLocals: 8,
    },
    {
      // Same pay and organization as the viable union, in a state where living
      // costs run 12% above baseline. The real wage is lower, so the same
      // expectation is a real grievance and the mandate has to reflect it.
      name: "viable union in an expensive state",
      workers: 3000,
      unionization: 45,
      wageLevel: 1,
      workerExpectationIndex: 1.03,
      costOfLivingIndex: 112,
      unemploymentRate: 6,
      unionLawBias: 0,
      treasury: 2400,
      organizedLocals: 4,
    },
    {
      // Ladder reachability, one rung per profile. These pin that each rung is
      // unlocked by a shop floor a player can actually build, now that
      // grievance reads a real cost-of-living-adjusted wage gap. Without a
      // working grievance term the top rung needed near-total coverage, which
      // no drift ceiling reaches without political levers.
      name: "rung 1: modest local, shallow grievance",
      workers: 2000,
      unionization: 40,
      wageLevel: 1,
      workerExpectationIndex: 1.05,
      unemploymentRate: 5,
      unionLawBias: 0,
      treasury: 1200,
      organizedLocals: 2,
    },
    {
      name: "rung 2: organized local, real wage gap",
      workers: 4000,
      unionization: 60,
      wageLevel: 1,
      workerExpectationIndex: 1.12,
      unemploymentRate: 5,
      unionLawBias: 0,
      treasury: 3200,
      organizedLocals: 5,
    },
    {
      name: "rung 3: mass-organized local, deep grievance",
      workers: 9000,
      unionization: 85,
      wageLevel: 1,
      workerExpectationIndex: 1.2,
      unemploymentRate: 5,
      unionLawBias: 0,
      treasury: 9000,
      organizedLocals: 9,
    },
  ];

export function simulateIndustrialRelationsBalance(
  scenario: IndustrialRelationsBalanceScenario
): IndustrialRelationsBalanceResult {
  const industryStrikeCost = strikeCallCost(scenario.organizedLocals);
  const selectiveLocals = Math.max(1, Math.ceil(scenario.organizedLocals / 2));
  const mandate = buildBargainingMandate({
    locals: [
      {
        workers: scenario.workers,
        unionization: scenario.unionization,
        wageLevel: scenario.wageLevel,
        workerExpectationIndex: scenario.workerExpectationIndex,
        costOfLivingIndex: scenario.costOfLivingIndex,
      },
    ],
    laborTightness: laborTightnessFromUnemployment(scenario.unemploymentRate),
    lawSupport: lawSupportFromBias(scenario.unionLawBias),
    treasury: scenario.treasury,
    strikeCost: industryStrikeCost,
  });

  return {
    name: scenario.name,
    support: mandate.support,
    leverage: mandate.leverage,
    strikeFundRunway: mandate.strikeFundRunway,
    canOvertimeBan: mandate.support >= BARGAINING_ESCALATION_SUPPORT.overtime_ban,
    canSelectiveStrike: mandate.support >= BARGAINING_ESCALATION_SUPPORT.selective_strike,
    canIndustryStrike: mandate.support >= BARGAINING_ESCALATION_SUPPORT.industry_strike,
    selectiveStrikeCost: strikeCallCost(selectiveLocals),
    industryStrikeCost,
    overtimeBanOutputLossPercent: Math.round((1 - OVERTIME_BAN_OUTPUT_FACTOR) * 10_000) / 100,
    selectiveStrikeScopeOutputLossPercent:
      STRIKE_REVENUE_THROTTLE * (selectiveLocals / scenario.organizedLocals) * 100,
    industryStrikeOutputLossPercent: STRIKE_REVENUE_THROTTLE * 100,
  };
}

export function runIndustrialRelationsBalanceScenarios() {
  return INDUSTRIAL_RELATIONS_BALANCE_SCENARIOS.map(simulateIndustrialRelationsBalance);
}
