/**
 * Per-race-family integration tests for the §7.3.2 swing-flow engine.
 *
 * Per the §7.3.3 design-doc table, every general-election family is
 * spec'd to consume Org + Reg + Support. #4E verifies that the new
 * engine produces a valid final-share distribution for each family with
 * realistic inputs, and that the winner-order agrees with the legacy
 * engine for inputs that have a clear winner (calibration sanity for
 * the dual-path period).
 *
 * Each test exercises the engine with country / region / party combos
 * representative of that family. Acceptance is intentionally lenient
 * (winner-order match, conservation, no negatives) rather than tight
 * margin matching — calibration drift is exactly what the diff-test
 * harness in #4F is for.
 */

import { describe, expect, it } from "vitest";
import { distributeVotesBySwingFlow } from "./voteDistributionSwingFlow";
import { distributeVotesByGroupLevelAllocation } from "./voteDistribution";
import type { EnrichedCandidate, DistributeVotesOptions } from "./types";
import type { CountryId } from "@/lib/constants/countries";
import type { DemographicCategory, StateDemographics } from "@/lib/db/types";

type Family = {
  /** Race family name (matches the §7.3.3 table). */
  name: string;
  /** Country for `getMajorPartiesForRegion`. */
  countryId: CountryId;
  /** Optional UK / multi-region parent region. */
  parentRegionId?: string;
  /** Candidates in the race. */
  candidates: EnrichedCandidate[];
  /** Party Org map. */
  orgs: Map<string, number>;
  /** Optional Reg map (engine treats undefined as neutral). */
  regs?: Map<string, number>;
  /** Voting system: defaults to FPTP. */
  votingSystem?: "fptp" | "rcv";
};

function candidate(
  id: string,
  party: string,
  positions: [number, number],
  support = 50,
  extra: Partial<EnrichedCandidate> = {}
): EnrichedCandidate {
  return {
    candidateId: id,
    party,
    isNPP: false,
    politicalInfluence: 60,
    nationalInfluence: 60,
    favorability: 50,
    support,
    charEP: positions[0],
    charSP: positions[1],
    partyEcon: positions[0],
    partySocial: positions[1],
    archetypeApprovals: {},
    infamy: 0,
    ...extra,
  } as EnrichedCandidate;
}

const symmetricDemographics: StateDemographics = {
  _id: "TS",
  categoryWeights: { income: 100 },
  groups: {
    low: { population: 50, turnout: 60, economicLean: -1, socialLean: 0 },
    high: { population: 50, turnout: 60, economicLean: 1, socialLean: 0 },
  },
} as unknown as StateDemographics;

const symmetricCategories: DemographicCategory[] = [
  {
    _id: "income",
    name: "Income",
    groups: [
      {
        id: "low",
        name: "Low income",
        defaultEconomicLean: -1,
        defaultSocialLean: 0,
        defaultTurnout: 60,
      },
      {
        id: "high",
        name: "High income",
        defaultEconomicLean: 1,
        defaultSocialLean: 0,
        defaultTurnout: 60,
      },
    ],
  } as unknown as DemographicCategory,
];

const FAMILIES: Family[] = [
  // US senate — single-seat FPTP, two candidates.
  {
    name: "US senate general",
    countryId: "US",
    candidates: [
      candidate("c1", "democrat", [-1, -1], 70),
      candidate("c2", "republican", [1, 1], 40),
    ],
    orgs: new Map([
      ["democrat", 55],
      ["republican", 45],
    ]),
    regs: new Map([
      ["democrat", 50],
      ["republican", 45],
    ]),
  },
  // US house / state senate — multi-candidate per party allowed.
  {
    name: "US house / state senate general",
    countryId: "US",
    candidates: [
      candidate("h1", "democrat", [-1, -1], 60),
      candidate("h2", "republican", [1, 1], 55),
    ],
    orgs: new Map([
      ["democrat", 50],
      ["republican", 50],
    ]),
  },
  // US governor — single-seat FPTP, three-way (with a third party).
  {
    name: "US governor general",
    countryId: "US",
    candidates: [
      candidate("g1", "democrat", [-1, -1], 55),
      candidate("g2", "republican", [1, 1], 60),
      candidate("g3", "green", [-2, -3], 40),
    ],
    orgs: new Map([
      ["democrat", 45],
      ["republican", 50],
      ["green", 5],
    ]),
  },
  // UK commons — England, two major parties.
  {
    name: "UK commons general (England)",
    countryId: "UK",
    parentRegionId: "ENG",
    candidates: [
      candidate("uk1", "uk_labour", [-1, -1], 65),
      candidate("uk2", "uk_conservative", [1, 1], 50),
      candidate("uk3", "uk_libdem", [0, -1], 45),
    ],
    orgs: new Map([
      ["uk_labour", 45],
      ["uk_conservative", 40],
      ["uk_libdem", 15],
    ]),
  },
  // UK regional council — Scotland, SNP-major
  {
    name: "UK regional council general (Scotland)",
    countryId: "UK",
    parentRegionId: "SCO",
    candidates: [
      candidate("sc1", "uk_snp", [-1, -2], 70),
      candidate("sc2", "uk_labour", [-1, -1], 50),
      candidate("sc3", "uk_conservative", [1, 1], 40),
    ],
    orgs: new Map([
      ["uk_snp", 50],
      ["uk_labour", 35],
      ["uk_conservative", 15],
    ]),
  },
  // JP shugiin / sangiin — LDP dominant.
  {
    name: "JP shugiin general (FPTP component)",
    countryId: "JP",
    candidates: [candidate("jp1", "ldp", [1, 1], 60), candidate("jp2", "cdp", [-2, -2], 45)],
    orgs: new Map([
      ["ldp", 55],
      ["cdp", 30],
    ]),
  },
  // DE bundestag — multi-party, party-list dominant in real life but the
  // engine still goes through the same per-candidate appeal kernel.
  {
    name: "DE bundestag general",
    countryId: "DE",
    candidates: [
      candidate("de1", "cdu", [1, 1], 55),
      candidate("de2", "spd", [-2, -2], 50),
      candidate("de3", "greens", [-2, -3], 45),
    ],
    orgs: new Map([
      ["cdu", 35],
      ["spd", 35],
      ["greens", 20],
    ]),
  },
  // DE landtag — same structure as bundestag at the engine level.
  {
    name: "DE landtag general",
    countryId: "DE",
    candidates: [candidate("dlt1", "cdu", [1, 1], 60), candidate("dlt2", "spd", [-2, -2], 55)],
    orgs: new Map([
      ["cdu", 50],
      ["spd", 40],
    ]),
  },
  // JP regional council — LDP + JSP (1991-era).
  {
    name: "JP regional council general (1991-era)",
    countryId: "JP",
    candidates: [
      candidate("jpr1", "jp_ldp", [1, 1], 55),
      candidate("jpr2", "jp_jsp", [-2, -2], 60),
    ],
    orgs: new Map([
      ["jp_ldp", 60],
      ["jp_jsp", 35],
    ]),
  },
  // RCV system — same race structure but with rcv flag (no FPTP spoiler).
  // N1 (tribal bonus) amplifies small Support gaps differently between
  // engines, so the "clearly-leaning" winner-match test needs decisive
  // inputs. Bumped Dem support 60→80 and lowered Rep/Grn so Dem wins
  // clearly in both engines.
  {
    name: "US senate general (RCV state)",
    countryId: "US",
    candidates: [
      candidate("rcv1", "democrat", [-1, -1], 80),
      candidate("rcv2", "republican", [1, 1], 40),
      candidate("rcv3", "green", [-2, -3], 30),
    ],
    orgs: new Map([
      ["democrat", 50],
      ["republican", 35],
      ["green", 15],
    ]),
    votingSystem: "rcv",
  },
];

describe("§7.3.2 swing-flow per-race-family integration", () => {
  for (const family of FAMILIES) {
    describe(family.name, () => {
      const baseOptions: DistributeVotesOptions = {
        isGeneralElection: true,
        countryId: family.countryId,
        parentRegionId: family.parentRegionId,
        votingSystem: family.votingSystem ?? "fptp",
        regByParty: family.regs,
      };

      it("produces a non-negative final-share distribution that conserves total votes", () => {
        const out = distributeVotesBySwingFlow(
          family.candidates,
          1_000_000,
          1_000_000,
          1_000_000,
          symmetricDemographics,
          symmetricCategories,
          family.orgs,
          baseOptions
        );
        for (const ec of family.candidates) {
          expect(out.votesPerCandidate[ec.candidateId]).toBeGreaterThanOrEqual(0);
        }
        const total = Object.values(out.votesPerCandidate).reduce((s, v) => s + v, 0);
        expect(total).toBeGreaterThan(0);
        // Conservation: total final votes ≤ effective pool (peeling is
        // zero-sum across the swing matrix, but FPTP spoiler can shift
        // votes between candidates without changing the sum).
        expect(total).toBeLessThanOrEqual(1_000_000 * 1.0001);
      });

      it("share percentages sum to approximately 100", () => {
        const out = distributeVotesBySwingFlow(
          family.candidates,
          1_000_000,
          1_000_000,
          1_000_000,
          symmetricDemographics,
          symmetricCategories,
          family.orgs,
          baseOptions
        );
        const totalShare = Object.values(out.sharesPct).reduce((s, v) => s + v, 0);
        // Rounded to 1 decimal so small rounding error is expected.
        expect(totalShare).toBeGreaterThan(99);
        expect(totalShare).toBeLessThan(101);
      });

      it("picks the same winner as the legacy engine for clearly-leaning inputs", () => {
        const swing = distributeVotesBySwingFlow(
          family.candidates,
          1_000_000,
          1_000_000,
          1_000_000,
          symmetricDemographics,
          symmetricCategories,
          family.orgs,
          baseOptions
        );
        const legacy = distributeVotesByGroupLevelAllocation(
          family.candidates,
          1_000_000,
          1_000_000,
          1_000_000,
          symmetricDemographics,
          symmetricCategories,
          family.orgs,
          baseOptions
        );
        const swingWinner = Object.entries(swing.votesPerCandidate).sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0];
        const legacyWinner = Object.entries(legacy.votesPerCandidate).sort(
          (a, b) => b[1] - a[1]
        )[0]?.[0];
        expect(swingWinner).toBe(legacyWinner);
      });
    });
  }
});
