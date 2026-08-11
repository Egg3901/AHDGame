/**
 * Resolution-path coverage for the beta parliamentary lower chambers
 * (FR/IT/ES/SE/TR — #3239): the generic multi-seat Largest-Remainder
 * allocator must treat the new election types as multi-seat and split a
 * synthetic tally proportionally across the region's chamber seats.
 *
 * Mirrors the "CN npcDelegate resolution metadata" suite in
 * electionResolution.test.ts.
 */
import { describe, it, expect } from "vitest";
import { allocateSeats } from "./seatAllocation";
import { MULTI_SEAT_TYPES, officeKeyForElectionType } from "@/lib/utils/electionLabels";
import { getElectionMethod, positionForElectionType } from "@/lib/elections/electionMethod";
import { DEFAULT_DURATIONS } from "@/lib/constants/electionDurations";
import { canonicalTurnsForCycle } from "@/lib/elections/canonicalCycle";

const BETA_TYPES = [
  ["FR", "assembleeNationale"],
  ["IT", "cameraDeputati"],
  ["ES", "congresoDiputados"],
  ["SE", "riksdag"],
  ["TR", "milletMeclisi"],
] as const;

describe("beta parliament resolution metadata (#3239)", () => {
  it.each(BETA_TYPES)("%s %s is registered as a multi-seat lowerChamber type", (cc, type) => {
    expect(MULTI_SEAT_TYPES.has(type)).toBe(true);
    expect(positionForElectionType(type)).toBe("lowerChamber");
    expect(getElectionMethod(cc, type)).toBe("pr_hareQuota");
    // Winners hold the office-type key (deputy/member), not the chamber key —
    // must match getLowerChamberOfficeType / econ-tier / backfill so elections
    // clear the same electedOfficials the seeders wrote.
    const officeType =
      type === "riksdag"
        ? "member"
        : type === "assembleeNationale" ||
            type === "cameraDeputati" ||
            type === "congresoDiputados" ||
            type === "milletMeclisi"
          ? "deputy"
          : type;
    expect(officeKeyForElectionType(type, cc)).toBe(officeType);
    // 48h window (24h primary + 24h general)
    expect(DEFAULT_DURATIONS[type].durationHours).toBe(48);
    expect(DEFAULT_DURATIONS[type].primaryDurationHours).toBe(24);
    expect(DEFAULT_DURATIONS[type].generalDurationHours).toBe(24);
  });

  it("ES 1953 has no canonical cycle at any cycle number (era-gated)", () => {
    for (const cycle of [1, 2, 5, 20]) {
      expect(
        canonicalTurnsForCycle({
          electionType: "congresoDiputados",
          cycle,
          ctx: { startingYear: 1953, preset: "1953-default" },
        })
      ).toBeNull();
    }
  });

  it("cycle periods: FR/IT 240 turns, ES/SE/TR 192 turns (1991 preset)", () => {
    const ctx = { startingYear: 1991, preset: "1991-default" };
    const period = (type: string) => {
      const c1 = canonicalTurnsForCycle({ electionType: type, cycle: 1, ctx })!;
      const c2 = canonicalTurnsForCycle({ electionType: type, cycle: 2, ctx })!;
      return c2.endTurn - c1.endTurn;
    };
    expect(period("assembleeNationale")).toBe(240);
    expect(period("cameraDeputati")).toBe(240);
    expect(period("congresoDiputados")).toBe(192);
    expect(period("riksdag")).toBe(192);
    expect(period("milletMeclisi")).toBe(192);
  });
});

describe("beta parliament synthetic-tally seat allocation", () => {
  // A 40-seat SE_STO-style Riksdag region with a three-party synthetic tally.
  const ranked = [
    { id: "sap", votes: 46_000, party: "se_sap" },
    { id: "m", votes: 34_000, party: "se_m" },
    { id: "vpk", votes: 20_000, party: "se_vpk" },
  ];
  const totalVotes = 100_000;

  it("riksdag: Largest Remainder splits 40 seats ~46/34/20", () => {
    const result = allocateSeats("riksdag", "SE_STO", 40, ranked, totalVotes);
    expect(result.authoritativeSeats).toBe(40);
    // All three parties clear the eligibility gate; LR quotas are exact here.
    expect(result.seatsEstimate.sap).toBe(18); // 46% of 40 = 18.4 → 18
    expect(result.seatsEstimate.m).toBe(14); // 34% of 40 = 13.6 → 14 (remainder)
    expect(result.seatsEstimate.vpk).toBe(8); // 20% of 40 = 8.0
    const totalAllocated = Object.values(result.seatsEstimate).reduce((a, b) => a + b, 0);
    expect(totalAllocated).toBe(40);
    // Every seat-winning candidate is in winners
    expect(result.winners.map(([id]) => id).sort()).toEqual(["m", "sap", "vpk"]);
  });

  it.each(BETA_TYPES)("%s %s allocates multi-seat (not winner-take-one)", (_cc, type) => {
    const result = allocateSeats(type, "REGION_A", 30, ranked, totalVotes);
    expect(result.authoritativeSeats).toBe(30);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((a, b) => a + b, 0);
    expect(totalAllocated).toBe(30);
    // Proportional: more than one candidate seats (single-seat would give 1/0/0)
    expect(result.winners.length).toBeGreaterThan(1);
  });
});
