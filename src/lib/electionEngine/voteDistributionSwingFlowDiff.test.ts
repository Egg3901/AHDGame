/**
 * #4F diff-test harness — runs representative fixtures through both
 * engines (legacy weight-multiplier vs §7.3.2 swing-flow) and asserts
 * that per-candidate margins stay within the documented tuning
 * tolerance.
 *
 * Tolerance: ±10 percentage points per the design doc. Wider than the
 * #4E "winner-order match" gate, because the swing-flow engine is
 * intentionally more discriminating than the legacy multiplier
 * (especially when Reg + multiple drivers stack). Catastrophic
 * calibration drift (a 30pt outcome flip) would fail this test long
 * before reaching production.
 *
 * Five fixtures matching the design-doc plan: 1992 House results in
 * five representative states (CA-large blue, TX-mixed lean R, WV-red,
 * RI-deep blue, FL-swing). Inputs are synthetic but party Org / Reg /
 * Support are seeded to reflect the actual 1992 partisan landscape.
 */

import { describe, expect, it } from "vitest";
import { distributeVotesBySwingFlow } from "./voteDistributionSwingFlow";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import type { EnrichedCandidate, DistributeVotesOptions } from "./types";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

interface Fixture {
  name: string;
  candidates: EnrichedCandidate[];
  orgs: Map<string, number>;
  regs: Map<string, number>;
  demographics: StateDemographics;
}

// All fixtures share these category definitions (income-based grouping
// kept simple to isolate the engine difference — real-world races have
// many more demographic dimensions but the engine path is the same).
const categories: DemographicCategory[] = [
  {
    _id: "income",
    name: "Income",
    groups: [
      {
        id: "low",
        name: "Low income",
        defaultEconomicLean: -1,
        defaultSocialLean: 0,
        defaultTurnout: 55,
      },
      {
        id: "high",
        name: "High income",
        defaultEconomicLean: 1,
        defaultSocialLean: 0,
        defaultTurnout: 65,
      },
    ],
  } as unknown as DemographicCategory,
];

function demographics(blueWeight: number): StateDemographics {
  // blueWeight is the fraction of the state's voters in the low-income
  // (Dem-leaning) bucket. 0.5 = balanced. >0.5 = blue-leaning state.
  // <0.5 = red-leaning state.
  return {
    _id: "TS",
    categoryWeights: { income: 100 },
    groups: {
      low: { population: blueWeight * 100, turnout: 55, economicLean: -1, socialLean: 0 },
      high: { population: (1 - blueWeight) * 100, turnout: 65, economicLean: 1, socialLean: 0 },
    },
  } as unknown as StateDemographics;
}

function candidate(party: string, support: number, ep: number, sp: number): EnrichedCandidate {
  return {
    candidateId: `c-${party}`,
    party,
    isNPP: false,
    politicalInfluence: 60,
    nationalInfluence: 60,
    favorability: 50,
    support,
    charEP: ep,
    charSP: sp,
    partyEcon: ep,
    partySocial: sp,
    archetypeApprovals: {},
    infamy: 0,
  } as EnrichedCandidate;
}

const fixtures: Fixture[] = [
  {
    name: "1992 House CA (large blue state)",
    candidates: [candidate("democrat", 60, -1, -1), candidate("republican", 50, 1, 1)],
    orgs: new Map([
      ["democrat", 55],
      ["republican", 35],
    ]),
    regs: new Map([
      ["democrat", 50],
      ["republican", 30],
    ]),
    demographics: demographics(0.55),
  },
  {
    name: "1992 House TX (mixed, lean R)",
    candidates: [candidate("democrat", 55, -1, -1), candidate("republican", 60, 1, 1)],
    orgs: new Map([
      ["democrat", 42],
      ["republican", 48],
    ]),
    regs: new Map([
      ["democrat", 38],
      ["republican", 42],
    ]),
    demographics: demographics(0.45),
  },
  {
    name: "1992 House WV (red lean, Dem holdover)",
    candidates: [candidate("democrat", 60, -1, 0), candidate("republican", 55, 1, 1)],
    // WV in 1992 still had Dem federal incumbents (party loyalty
    // running ahead of presidential vote) — high Dem Org.
    orgs: new Map([
      ["democrat", 60],
      ["republican", 30],
    ]),
    regs: new Map([
      ["democrat", 55],
      ["republican", 25],
    ]),
    demographics: demographics(0.5),
  },
  {
    name: "1992 House RI (deep blue)",
    candidates: [candidate("democrat", 65, -1, -1), candidate("republican", 45, 1, 1)],
    orgs: new Map([
      ["democrat", 70],
      ["republican", 25],
    ]),
    regs: new Map([
      ["democrat", 65],
      ["republican", 20],
    ]),
    demographics: demographics(0.6),
  },
  {
    name: "1992 House FL (swing)",
    candidates: [candidate("democrat", 55, -1, -1), candidate("republican", 55, 1, 1)],
    orgs: new Map([
      ["democrat", 45],
      ["republican", 45],
    ]),
    regs: new Map([
      ["democrat", 40],
      ["republican", 42],
    ]),
    demographics: demographics(0.5),
  },
];

const POOL = 1_000_000;
const MAX_MARGIN_DRIFT_PTS = 10;

describe("§7.3.2 swing-flow — diff against legacy engine (#4F)", () => {
  for (const fixture of fixtures) {
    it(`${fixture.name}: winner agrees + margins stay within ±${MAX_MARGIN_DRIFT_PTS}pt`, () => {
      const baseOptions: DistributeVotesOptions = {
        isGeneralElection: true,
        countryId: "US",
        votingSystem: "fptp",
        regByParty: fixture.regs,
      };
      const swing = distributeVotesBySwingFlow(
        fixture.candidates,
        POOL,
        POOL,
        POOL,
        fixture.demographics,
        categories,
        fixture.orgs,
        baseOptions
      );
      const legacy = distributeVotesByGroupLevelAllocation(
        fixture.candidates,
        POOL,
        POOL,
        POOL,
        fixture.demographics,
        categories,
        fixture.orgs,
        baseOptions
      );

      // Winner-order agreement.
      const swingWinner = Object.entries(swing.votesPerCandidate).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0];
      const legacyWinner = Object.entries(legacy.votesPerCandidate).sort(
        (a, b) => b[1] - a[1]
      )[0]?.[0];
      expect(swingWinner).toBe(legacyWinner);

      // Margin drift per candidate ≤ tolerance.
      for (const ec of fixture.candidates) {
        const swingShare = swing.sharesPct[ec.candidateId];
        const legacyShare = legacy.sharesPct[ec.candidateId];
        const drift = Math.abs(swingShare - legacyShare);
        expect(
          drift,
          `${fixture.name}: ${ec.candidateId} drift = ${drift.toFixed(1)}pt (swing ${swingShare}, legacy ${legacyShare})`
        ).toBeLessThanOrEqual(MAX_MARGIN_DRIFT_PTS);
      }
    });
  }
});
