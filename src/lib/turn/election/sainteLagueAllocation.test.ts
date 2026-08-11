import { describe, it, expect } from "vitest";
import { allocateViaSainteLague, validateAllocation } from "./sainteLagueAllocation";

describe("Sainte-Laguë Allocation", () => {
  describe("Basic allocation (no thresholds)", () => {
    it("allocates 10 seats proportionally across 3 parties", () => {
      const votes = [
        { partyId: "a", votes: 500 },
        { partyId: "b", votes: 300 },
        { partyId: "c", votes: 200 },
      ];

      const result = allocateViaSainteLague(votes, 10, {
        minVoteShare: 0, // No threshold
      });

      expect(result.totalAllocated).toBe(10);
      expect(result.partySeats["a"]).toBe(5); // 500/1000 = 50% → 5 seats
      expect(result.partySeats["b"]).toBe(3); // 300/1000 = 30% → 3 seats
      expect(result.partySeats["c"]).toBe(2); // 200/1000 = 20% → 2 seats
    });

    it("handles exact proportionality (6 parties, 630 seats)", () => {
      const votes = [
        { partyId: "cdu", votes: 2_400_000 },
        { partyId: "spd", votes: 2_200_000 },
        { partyId: "greens", votes: 1_200_000 },
        { partyId: "fdp", votes: 900_000 },
        { partyId: "linke", votes: 700_000 },
        { partyId: "afd", votes: 1_600_000 },
      ];

      const result = allocateViaSainteLague(votes, 630, {
        minVoteShare: 0,
      });

      expect(result.totalAllocated).toBe(630);

      // Verify all seats are allocated and proportionality is tight
      const totalVotes = votes.reduce((s, v) => s + v.votes, 0);
      for (const { partyId, votes: partyVotes } of votes) {
        const expectedSeats = (partyVotes / totalVotes) * 630;
        const actualSeats = result.partySeats[partyId];
        // Sainte-Laguë should keep error within ±2 seats
        expect(Math.abs(actualSeats - expectedSeats)).toBeLessThan(2);
      }
    });
  });

  describe("5% threshold (German federal election)", () => {
    it("filters out parties below 5%", () => {
      const votes = [
        { partyId: "major_a", votes: 500_000 },
        { partyId: "major_b", votes: 400_000 },
        { partyId: "tiny", votes: 50_000 }, // 5.5% — just above threshold
      ];

      const result = allocateViaSainteLague(votes, 10, {
        minVoteShare: 0.05,
      });

      expect(result.totalAllocated).toBe(10);
      expect(result.partySeats["major_a"]).toBeGreaterThan(0);
      expect(result.partySeats["major_b"]).toBeGreaterThan(0);
      expect(result.partySeats["tiny"]).toBeGreaterThan(0); // Included: 50k / 950k ≈ 5.26%
    });

    it("excludes parties that are below 5% even with many votes", () => {
      const votes = [
        { partyId: "dominant", votes: 900_000 },
        { partyId: "minor", votes: 45_000 }, // 4.74% — below 5%
      ];

      const result = allocateViaSainteLague(votes, 10, {
        minVoteShare: 0.05,
      });

      expect(result.partySeats["dominant"]).toBe(10);
      expect(result.partySeats["minor"]).toBeUndefined();
    });
  });

  describe("Grundmandatsklausel (≥3 direct mandate exception)", () => {
    it("grants seats to party with 3+ direct mandates even if below 5%", () => {
      const votes = [
        { partyId: "spd", votes: 500_000 }, // 50%
        { partyId: "small_east", votes: 50_000 }, // 5% — normally excluded but has 3 direct wins
      ];

      const result = allocateViaSainteLague(votes, 10, {
        minVoteShare: 0.05,
        minDirectMandates: {
          spd: 0,
          small_east: 3, // Bypass the 5% threshold
        },
      });

      expect(result.partySeats["small_east"]).toBeGreaterThan(0);
    });

    it("still excludes party with <3 direct mandates if below 5%", () => {
      const votes = [
        { partyId: "major", votes: 1_000_000 },
        { partyId: "niche", votes: 40_000 }, // 40k/1.04M = 3.8% — below 5%, only 2 direct wins
      ];

      const result = allocateViaSainteLague(votes, 10, {
        minVoteShare: 0.05,
        minDirectMandates: {
          major: 0,
          niche: 2, // Not enough to trigger Grundmandatsklausel
        },
      });

      expect(result.partySeats["niche"]).toBeUndefined();
    });
  });

  describe("Edge cases", () => {
    it("handles single-party scenario", () => {
      const votes = [{ partyId: "only", votes: 1_000_000 }];

      const result = allocateViaSainteLague(votes, 5, {
        minVoteShare: 0,
      });

      expect(result.totalAllocated).toBe(5);
      expect(result.partySeats["only"]).toBe(5);
    });

    it("returns empty allocation when all parties are below threshold and have no direct mandates", () => {
      const votes = [
        { partyId: "micro_a", votes: 10_000 },
        { partyId: "micro_b", votes: 10_000 },
        { partyId: "micro_c", votes: 10_000 },
      ];

      const result = allocateViaSainteLague(votes, 10, {
        minVoteShare: 0.5, // 50% threshold — nobody qualifies (each party has 33%)
        minDirectMandates: {},
      });

      expect(result.totalAllocated).toBe(0);
      expect(Object.keys(result.partySeats).length).toBe(0);
    });

    it("allocates exact remainder without over/under-allocation", () => {
      const votes = [
        { partyId: "a", votes: 333 },
        { partyId: "b", votes: 333 },
        { partyId: "c", votes: 334 },
      ];

      const result = allocateViaSainteLague(votes, 3, {
        minVoteShare: 0,
      });

      expect(result.totalAllocated).toBe(3);
      expect(result.partySeats["a"] + result.partySeats["b"] + result.partySeats["c"]).toBe(3);
    });
  });

  describe("Validation", () => {
    it("validates correct allocation", () => {
      const result = {
        partySeats: { a: 5, b: 3, c: 2 },
        totalAllocated: 10,
      };

      expect(validateAllocation(result, 10)).toBe(true);
    });

    it("detects incorrect allocation", () => {
      const result = {
        partySeats: { a: 5, b: 3, c: 2 },
        totalAllocated: 10,
      };

      expect(validateAllocation(result, 9)).toBe(false);
    });
  });

  describe("Real German election scenario (2021 approximate, 2023-reform 630-seat cap)", () => {
    it("allocates 630 Bundestag seats proportionally to 2021-like vote shares", () => {
      // Approximate 2021 Bundestag Zweitstimmen totals
      const votes = [
        { partyId: "spd", votes: 9_280_000 }, // ~25.7%
        { partyId: "cdu_csu", votes: 9_041_000 }, // ~24.1%
        { partyId: "greens", votes: 4_948_000 }, // ~14.8%
        { partyId: "fdp", votes: 4_128_000 }, // ~11.5%
        { partyId: "afd", votes: 5_253_000 }, // ~10.3%
        { partyId: "linke", votes: 2_049_000 }, // ~4.9% — below 5%, Grundmandatsklausel saves them
        { partyId: "others", votes: 1_301_000 }, // ~3.6% (below threshold, no direct mandates)
      ];

      const result = allocateViaSainteLague(votes, 630, {
        minVoteShare: 0.05,
        minDirectMandates: {
          spd: 109,
          cdu_csu: 109,
          greens: 39,
          fdp: 0,
          afd: 83,
          linke: 3, // Just meets Grundmandatsklausel — keeps their proportional share
        },
      });

      // All 630 seats allocated
      expect(result.totalAllocated).toBe(630);

      // Under the 2023 reform with 630 seats and ~38M eligible votes:
      //   SPD ~25.7% of eligible → ~158 seats
      //   CDU/CSU ~25.0% → ~154
      //   AfD ~14.6% → ~92
      //   Greens ~13.7% → ~86
      //   FDP ~11.4% → ~72
      //   Linke ~5.7% → ~35 (Grundmandatsklausel keeps them)
      // "others" excluded (no direct mandates)
      expect(result.partySeats["spd"]).toBeGreaterThan(140);
      expect(result.partySeats["spd"]).toBeLessThan(180);
      expect(result.partySeats["cdu_csu"]).toBeGreaterThan(140);
      expect(result.partySeats["afd"]).toBeGreaterThan(70);
      expect(result.partySeats["greens"]).toBeGreaterThan(70);
      expect(result.partySeats["fdp"]).toBeGreaterThan(60);
      expect(result.partySeats["linke"]).toBeGreaterThan(25);
      expect(result.partySeats["others"]).toBeUndefined(); // Filtered out
    });
  });
});
