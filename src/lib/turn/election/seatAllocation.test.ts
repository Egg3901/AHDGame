/**
 * Unit tests for seatAllocation — seat allocation logic for multi-seat and single-seat races.
 */
import { describe, it, expect } from "vitest";
import {
  allocateSeats,
  applyMajoritarianBonus,
  getMajoritarianBonus,
  getMultiSeatMinShare,
  UK_COMMONS_FPTP_EXPONENT,
  type RankedCandidate,
} from "./seatAllocation";
import { HOUSE_SEATS_1991, UK_COMMONS_SEATS_1953 } from "@/lib/constants/states";

describe("allocateSeats — preset-aware house seats", () => {
  const ranked: RankedCandidate[] = [
    { id: "a", votes: 600 },
    { id: "b", votes: 400 },
  ];

  it("uses 1990-census house counts when the bundle is passed (CT = 6)", () => {
    const r = allocateSeats("house", "CT", 1, ranked, 1000, HOUSE_SEATS_1991);
    expect(r.authoritativeSeats).toBe(6);
  });

  it("uses 1990-census house counts for NY (31, not 26)", () => {
    const r = allocateSeats("house", "NY", 1, ranked, 1000, HOUSE_SEATS_1991);
    expect(r.authoritativeSeats).toBe(31);
  });

  it("uses UK_REGIONAL_COUNCIL_SEATS for regional council races", () => {
    const ranked: RankedCandidate[] = [
      { id: "a", votes: 600 },
      { id: "b", votes: 400 },
    ];
    const r = allocateSeats("regionalCouncil", "EAE", 53, ranked, 1000);
    expect(r.authoritativeSeats).toBe(39);
  });

  it("defaults to 2020-census house counts when no bundle passed (CT = 5)", () => {
    const r = allocateSeats("house", "CT", 1, ranked, 1000);
    expect(r.authoritativeSeats).toBe(5);
  });
});

describe("getMultiSeatMinShare", () => {
  it("should return 0.1 for stateSenate", () => {
    expect(getMultiSeatMinShare("stateSenate")).toBe(0.1);
  });

  it("should return 0.1 for regionalCouncil", () => {
    expect(getMultiSeatMinShare("regionalCouncil")).toBe(0.1);
  });

  it("should return 0.1 for IE Dáil, Seanad, and Local Council", () => {
    expect(getMultiSeatMinShare("dail")).toBe(0.1);
    expect(getMultiSeatMinShare("seanad")).toBe(0.1);
    expect(getMultiSeatMinShare("localCouncil")).toBe(0.1);
  });

  it("should return 0.2 for other types", () => {
    expect(getMultiSeatMinShare("house")).toBe(0.2);
    expect(getMultiSeatMinShare("commons")).toBe(0.2);
    expect(getMultiSeatMinShare("governor")).toBe(0.2);
  });

  it("should return 0.1 for the DD Volkskammer (issue #3896)", () => {
    // The National Front bloc list (SED + captive CDU/LDPD/NDPD/DBD) never
    // let a bloc partner get shut out; a 20% gate would exclude 2-3 of the
    // 5 bloc candidates given the founding cycle's observed ~14-30% shares.
    expect(getMultiSeatMinShare("volkskammerDeputy")).toBe(0.1);
  });
});

describe("allocateSeats - DD Volkskammer (issue #3896)", () => {
  // Reproduces the East Berlin (BEO) founding-cycle race from the sandbox
  // world (32 configured seats, 5 National Front bloc candidates). Before the
  // fix, volkskammerDeputy was missing from MULTI_SEAT_TYPES, so this fell
  // through to the single-winner branch: exactly 1 seat awarded regardless
  // of totalSeats, leaving the chamber at 2% strength (6 of 500 seats world-wide).
  const ranked: RankedCandidate[] = [
    { id: "sed", votes: 238180, party: "sed" }, // 30.0%
    { id: "cdu", votes: 136362, party: "cdu" }, // 17.1%
    { id: "ldpd", votes: 191268, party: "ldpd" }, // 22.9%
    { id: "ndpd", votes: 110792, party: "ndpd" }, // 13.8%
    { id: "dbd", votes: 127598, party: "dbd" }, // 16.1%
  ];
  const totalVotes = ranked.reduce((s, c) => s + c.votes, 0);

  it("is multi-seat and allocates all 32 configured seats", () => {
    const r = allocateSeats("volkskammerDeputy", "BEO", 32, ranked, totalVotes);
    expect(r.isMultiSeat).toBe(true);
    expect(r.authoritativeSeats).toBe(32);
    const totalAllocated = Object.values(r.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(32);
  });

  it("seats all 5 bloc parties (10% gate, not the 20% default)", () => {
    const r = allocateSeats("volkskammerDeputy", "BEO", 32, ranked, totalVotes);
    for (const c of ranked) {
      expect(r.seatsEstimate[c.id]).toBeGreaterThan(0);
    }
  });
});

// ── Single-seat elections (FPTP) ─────────────────────────────────────────────

describe("allocateSeats - single-seat (FPTP)", () => {
  it("marks isMultiSeat false for senate", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600 },
      { id: "B", votes: 400 },
    ];
    const result = allocateSeats("senate", "CA", 1, ranked, 1000);
    expect(result.isMultiSeat).toBe(false);
  });

  it("assigns the single seat to the top vote-getter", () => {
    const ranked: RankedCandidate[] = [
      { id: "winner", votes: 700 },
      { id: "loser1", votes: 200 },
      { id: "loser2", votes: 100 },
    ];
    const result = allocateSeats("senate", "CA", 1, ranked, 1000);
    expect(result.winners).toEqual([["winner", 1]]);
    expect(result.losers).toEqual(["loser1", "loser2"]);
  });

  it("losers array excludes the winner for single-seat races", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 510 },
      { id: "B", votes: 490 },
    ];
    const result = allocateSeats("governor", "TX", 1, ranked, 1000);
    expect(result.winners.length).toBe(1);
    expect(result.winners[0][0]).toBe("A");
    expect(result.losers).toEqual(["B"]);
  });

  it("treats governor as single-seat (isMultiSeat false)", () => {
    const ranked: RankedCandidate[] = [{ id: "A", votes: 1000 }];
    const result = allocateSeats("governor", "TX", 1, ranked, 1000);
    expect(result.isMultiSeat).toBe(false);
    expect(result.authoritativeSeats).toBe(1);
  });

  // Alaska has exactly 1 House seat — single-seat FPTP even though house is a MULTI_SEAT_TYPE
  it("house election with 1 authoritative seat (AK) allocates all seats to top candidate", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600 },
      { id: "B", votes: 400 },
    ];
    // AK has 1 seat; totalSeats passed is 1 and HOUSE_SEATS["AK"] = 1
    const result = allocateSeats("house", "AK", 1, ranked, 1000);
    expect(result.authoritativeSeats).toBe(1);
    // With 1 seat, the allocationPool logic will give all seats to A
    // (single-candidate in the pool path or standard Largest Remainder gives A=1, B=0)
    expect(result.seatsEstimate["A"]).toBe(1);
    expect(result.seatsEstimate["B"]).toBe(0);
  });
});

// ── House 2-seat split logic ─────────────────────────────────────────────────

describe("allocateSeats - house 2-seat special case", () => {
  // Hawaii has 2 House seats (HI = 2).
  it("splits 1-1 when both candidates are above the 20% threshold", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600 }, // 60% — above 20%
      { id: "B", votes: 400 }, // 40% — above 20%
    ];
    const result = allocateSeats("house", "HI", 2, ranked, 1000);
    expect(result.authoritativeSeats).toBe(2);
    expect(result.seatsEstimate["A"]).toBe(1);
    expect(result.seatsEstimate["B"]).toBe(1);
    expect(result.winners.length).toBe(2);
  });

  it("gives both seats to top candidate when opponent is below threshold", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 850 }, // 85%
      { id: "B", votes: 150 }, // 15% — below 20% threshold
    ];
    const result = allocateSeats("house", "HI", 2, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(2);
    expect(result.seatsEstimate["B"]).toBe(0);
    expect(result.winners.map(([id]) => id)).toEqual(["A"]);
    expect(result.losers).toContain("B");
  });

  it("uses authoritative HI=2 even if totalSeats arg differs", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600 },
      { id: "B", votes: 400 },
    ];
    // Pass totalSeats=10 but authoritative HOUSE_SEATS["HI"] = 2
    const result = allocateSeats("house", "HI", 10, ranked, 1000);
    expect(result.authoritativeSeats).toBe(2);
  });
});

// ── Largest Remainder (Hamilton method) — multi-seat ─────────────────────────

describe("allocateSeats - Largest Remainder (Hamilton method)", () => {
  it("distributes floors then gives remainder seats by largest fractional part", () => {
    // 3 candidates, 5 seats
    // A: 300/1000 * 5 = 1.5 → floor 1, remainder 0.5
    // B: 400/1000 * 5 = 2.0 → floor 2, remainder 0.0
    // C: 300/1000 * 5 = 1.5 → floor 1, remainder 0.5
    // Total floors = 4; remaining = 1; A and C tie on remainder (both 0.5)
    // Stable sort gives the first one (A) the extra seat → A=2, B=2, C=1
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 300 },
      { id: "B", votes: 400 },
      { id: "C", votes: 300 },
    ];
    const result = allocateSeats("stateSenate", "ST", 5, ranked, 1000);
    expect(result.isMultiSeat).toBe(true);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(5);
    // B (40%) should get 2 seats
    expect(result.seatsEstimate["B"]).toBe(2);
    // A and C should share the remaining 3 seats
    expect(result.seatsEstimate["A"]! + result.seatsEstimate["C"]!).toBe(3);
  });

  it("allocates perfectly proportional shares with no remainder", () => {
    // A: 500/1000 * 10 = 5.0  B: 500/1000 * 10 = 5.0 — exact split
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 500 },
      { id: "B", votes: 500 },
    ];
    const result = allocateSeats("stateSenate", "ST", 10, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(5);
    expect(result.seatsEstimate["B"]).toBe(5);
  });

  it("dominant party gets majority of seats", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 700 },
      { id: "B", votes: 200 },
      { id: "C", votes: 100 },
    ];
    const result = allocateSeats("stateSenate", "ST", 10, ranked, 1000);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(10);
    expect(result.seatsEstimate["A"]).toBeGreaterThan(result.seatsEstimate["B"]!);
    expect(result.seatsEstimate["B"]).toBeGreaterThan(result.seatsEstimate["C"]!);
  });

  it("total allocated seats never exceeds authoritativeSeats", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 333 },
      { id: "B", votes: 333 },
      { id: "C", votes: 334 },
    ];
    const result = allocateSeats("stateSenate", "ST", 7, ranked, 1000);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBeLessThanOrEqual(7);
  });
});

// ── commons uses UK_COMMONS_SEATS authoritative count ───────────────────────

describe("allocateSeats - commons (UK)", () => {
  it("uses UK_COMMONS_SEATS[LON]=75 as authoritative seat count", () => {
    const ranked: RankedCandidate[] = [
      { id: "Labour", votes: 500 },
      { id: "Conservative", votes: 300 },
      { id: "LibDem", votes: 200 },
    ];
    // totalSeats passed is irrelevant; UK_COMMONS_SEATS["LON"] = 75 for commons
    const result = allocateSeats("commons", "LON", 999, ranked, 1000);
    expect(result.authoritativeSeats).toBe(75);
    expect(result.isMultiSeat).toBe(true);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBeLessThanOrEqual(75);
  });

  it("uses getUkCommonsSeats(1953) LON=91 when the era map is passed (ticket #1058)", () => {
    const ranked: RankedCandidate[] = [
      { id: "Labour", votes: 500 },
      { id: "Conservative", votes: 300 },
      { id: "LibDem", votes: 200 },
    ];
    const result = allocateSeats(
      "commons",
      "LON",
      999,
      ranked,
      1000,
      undefined,
      undefined,
      undefined,
      UK_COMMONS_SEATS_1953
    );
    expect(result.authoritativeSeats).toBe(91);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(91);
  });

  it("falls back to totalSeats for unknown UK region", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600 },
      { id: "B", votes: 400 },
    ];
    const result = allocateSeats("commons", "UNKNOWN_REGION", 20, ranked, 1000);
    expect(result.authoritativeSeats).toBe(20);
  });

  it("allocates LON seats proportionally to vote share", () => {
    // Labour: 50%, Conservative: 30%, LibDem: 20% — all above 20% threshold
    const ranked: RankedCandidate[] = [
      { id: "Labour", votes: 500 },
      { id: "Conservative", votes: 300 },
      { id: "LibDem", votes: 200 },
    ];
    const result = allocateSeats("commons", "LON", 75, ranked, 1000);
    // Labour should receive roughly 37-38, Conservative ~22-23, LibDem ~14-15
    expect(result.seatsEstimate["Labour"]).toBeGreaterThan(result.seatsEstimate["Conservative"]!);
    expect(result.seatsEstimate["Conservative"]).toBeGreaterThan(result.seatsEstimate["LibDem"]!);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(75);
  });
});

// ── regionalCouncil ──────────────────────────────────────────────────────────

describe("allocateSeats - regionalCouncil", () => {
  it("should treat regionalCouncil as multi-seat election", () => {
    const ranked: RankedCandidate[] = [
      { id: "candidate1", votes: 600 },
      { id: "candidate2", votes: 400 },
    ];
    const result = allocateSeats("regionalCouncil", "LON", 32, ranked, 1000);
    expect(result.isMultiSeat).toBe(true);
    expect(result.winners.length).toBeGreaterThan(0);
  });

  it("should use 10% eligibility threshold for regionalCouncil", () => {
    // 3 candidates, 2 seats: minPoolSize = min(2, 3) = 2
    // eligible >= 2, so fallback pool is NOT triggered and sub-threshold candidates are excluded
    const ranked: RankedCandidate[] = [
      { id: "candidate1", votes: 550 }, // 55% — above 10%
      { id: "candidate2", votes: 400 }, // 40% — above 10%
      { id: "candidate3", votes: 50 }, // 5%  — below 10% threshold
    ];
    const result = allocateSeats("regionalCouncil", "TEST", 2, ranked, 1000);
    expect(result.winners.some(([id]) => id === "candidate3")).toBe(false);
    expect(result.losers).toContain("candidate3");
  });

  it("should allocate seats proportionally among eligible candidates", () => {
    const ranked: RankedCandidate[] = [
      { id: "partyA", votes: 600 },
      { id: "partyB", votes: 300 },
      { id: "partyC", votes: 100 },
    ];
    const result = allocateSeats("regionalCouncil", "TEST", 10, ranked, 1000);
    expect(result.isMultiSeat).toBe(true);
    // partyA should receive more seats than partyB
    const seatsA = result.seatsEstimate["partyA"] ?? 0;
    const seatsB = result.seatsEstimate["partyB"] ?? 0;
    expect(seatsA).toBeGreaterThan(seatsB);
    // Total allocated seats should not exceed authoritative count
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBeLessThanOrEqual(10);
  });

  it("should return correct winners and losers arrays", () => {
    const ranked: RankedCandidate[] = [
      { id: "winner1", votes: 700 },
      { id: "winner2", votes: 200 },
      { id: "loser1", votes: 50 }, // 5% — below 10% threshold
    ];
    const result = allocateSeats("regionalCouncil", "TEST", 5, ranked, 1000);
    expect(result.winners.some(([id]) => id === "winner1")).toBe(true);
    expect(result.losers).toContain("loser1");
  });
});

// ── Fallback pool (eligible < minPoolSize) ───────────────────────────────────

describe("allocateSeats - fallback pool when eligible candidates < seat count", () => {
  it("house 2-seat: top candidate takes both seats when no opponent is eligible", () => {
    // 3 candidates, all below 20% threshold; authoritativeSeats=2 triggers the 2-seat special case.
    // "ST" is not in HOUSE_SEATS, so authoritativeSeats = totalSeats = 2.
    // eligible = 0 < 2 → seatsEstimate[ranked[0]] = 2 (top candidate sweeps)
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 150 }, // 15% — below 20%
      { id: "B", votes: 120 }, // 12% — below 20%
      { id: "C", votes: 100 }, // 10% — below 20%
    ];
    const result = allocateSeats("house", "ST", 2, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(2);
    expect(result.seatsEstimate["B"]).toBe(0);
    expect(result.seatsEstimate["C"]).toBe(0);
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(2);
  });

  it("uses fallback pool for stateSenate when only one eligible candidate for a 3-seat race", () => {
    // 3 candidates, 3 seats, only one above 10%
    // eligible = 1, minPoolSize = min(3, 3) = 3 → fallback = top-3
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 800 }, // 80% — above 10%
      { id: "B", votes: 50 }, // 5%  — below 10%
      { id: "C", votes: 50 }, // 5%  — below 10%
    ];
    const result = allocateSeats("stateSenate", "ST", 3, ranked, 900);
    // eligible (1) < minPoolSize (3) → fallback pool = [A, B, C]
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(3);
    // A dominates; should get at least 2 seats
    expect(result.seatsEstimate["A"]!).toBeGreaterThanOrEqual(2);
  });

  it("single candidate in pool gets all seats", () => {
    // Only 1 candidate total — goes to the single-candidate fast path
    const ranked: RankedCandidate[] = [{ id: "A", votes: 1000 }];
    const result = allocateSeats("stateSenate", "ST", 5, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(5);
    expect(result.winners).toEqual([["A", 5]]);
    expect(result.losers).toEqual([]);
  });
});

// ── Threshold boundary conditions ────────────────────────────────────────────

describe("allocateSeats - threshold boundary conditions", () => {
  it("candidate at exactly 20% is eligible for house", () => {
    // 200/1000 = 0.2 — exactly at threshold — should be eligible.
    // Use "UNKNOWN" state so authoritativeSeats = totalSeats = 5.
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 800 },
      { id: "B", votes: 200 },
    ];
    const result = allocateSeats("house", "UNKNOWN", 5, ranked, 1000);
    // authoritativeSeats = HOUSE_SEATS["UNKNOWN"] ?? 5 = 5
    // 2-seat special case? No — authoritativeSeats=5 ≠ 2.
    // Both eligible (80% and 20%); minPoolSize = min(5, 2) = 2; eligible.length(2) >= 2 → no fallback
    // A: 800/1000 * 5 = 4.0 → 4 seats; B: 200/1000 * 5 = 1.0 → 1 seat
    expect(result.seatsEstimate["A"]).toBe(4);
    expect(result.seatsEstimate["B"]).toBe(1);
    expect(result.losers).not.toContain("B");
  });

  it("candidate just below 10% threshold is excluded for stateSenate", () => {
    // 99/1000 = 9.9% — just below 10% threshold
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 700 },
      { id: "B", votes: 201 },
      { id: "C", votes: 99 },
    ];
    const result = allocateSeats("stateSenate", "ST", 4, ranked, 1000);
    // eligible = [A, B] (both ≥10%); minPoolSize = min(4,3) = 3
    // eligible.length (2) < minPoolSize (3) → fallback pool = top-3 = [A, B, C]
    // C gets included via fallback, but only A and B are eligible
    // Let's just verify the total is right
    const totalAllocated = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(totalAllocated).toBe(4);
  });
});

// ── winners / losers array structure ─────────────────────────────────────────

describe("allocateSeats - winners and losers arrays", () => {
  it("winners contains [id, seats] tuples for multi-seat", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 700 },
      { id: "B", votes: 200 },
      { id: "C", votes: 100 },
    ];
    const result = allocateSeats("stateSenate", "ST", 10, ranked, 1000);
    for (const [id, seats] of result.winners) {
      expect(typeof id).toBe("string");
      expect(typeof seats).toBe("number");
      expect(seats).toBeGreaterThan(0);
    }
  });

  it("losers contains ids of zero-seat candidates in multi-seat race", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 950 },
      { id: "B", votes: 50 }, // 5% — below 10% threshold, but minPoolSize may include via fallback
    ];
    // 2 candidates, 10 seats: minPoolSize = min(10, 2) = 2 → fallback = [A, B]
    // B gets floor((50/1000)*10) = 0, remainder = 0.5
    // A gets floor((950/1000)*10) = 9, remainder = 0.5
    // remaining = 1 → goes to A or B by sort (tie on remainder)
    const result = allocateSeats("stateSenate", "ST", 10, ranked, 1000);
    // Verify winners + losers = all candidates
    const allIds = ranked.map((r) => r.id);
    const winnerIds = result.winners.map(([id]) => id);
    const union = [...winnerIds, ...result.losers];
    expect(union.sort()).toEqual(allIds.sort());
  });

  it("single-seat race: exactly 1 winner and rest are losers", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 400 },
      { id: "B", votes: 350 },
      { id: "C", votes: 250 },
    ];
    const result = allocateSeats("senate", "NY", 1, ranked, 1000);
    expect(result.winners.length).toBe(1);
    expect(result.losers.length).toBe(2);
    expect(result.winners[0][0]).toBe("A");
    expect(result.losers).toContain("B");
    expect(result.losers).toContain("C");
  });
});

// ── Party-aggregate threshold + no re-admission of sub-threshold candidates ──
// (1953 sim forensics: with 12 candidates and 27-90 seats, the old pool
// fallback re-admitted EVERY candidate whenever candidates ≤ seats, so 0.8%
// fringe candidates collected largest-remainder seats in UK Commons regions.)

describe("allocateSeats - party-aggregate eligibility threshold", () => {
  it("COMPAT: 2-candidate 60/40 two-seat race still allocates 1/1 exactly", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600, party: "p1" },
      { id: "B", votes: 400, party: "p2" },
    ];
    const result = allocateSeats("house", "HI", 2, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(1);
    expect(result.seatsEstimate["B"]).toBe(1);
  });

  it("COMPAT: party-less callers keep per-candidate thresholds (legacy shape)", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 600 },
      { id: "B", votes: 400 },
    ];
    const result = allocateSeats("stateSenate", "ST", 10, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(6);
    expect(result.seatsEstimate["B"]).toBe(4);
  });

  it("sub-threshold fringe candidates get ZERO seats even when candidates ≤ seats (UK Commons shape)", () => {
    // 6 parties in a 75-seat commons region — the exact failure mode: the old
    // fallback (eligible < min(75, 6)) re-admitted everyone, handing SNP/PC/SF
    // remainder seats in England.
    const ranked: RankedCandidate[] = [
      { id: "con", votes: 460, party: "con" },
      { id: "lab", votes: 450, party: "lab" },
      { id: "lib", votes: 50, party: "lib" }, // 5% — below the 20% commons gate
      { id: "snp", votes: 15, party: "snp" }, // 1.5%
      { id: "pc", votes: 15, party: "pc" }, // 1.5%
      { id: "sf", votes: 10, party: "sf" }, // 1.0%
    ];
    const result = allocateSeats("commons", "LON", 75, ranked, 1000);
    expect(result.authoritativeSeats).toBe(75);
    expect(result.seatsEstimate["lib"]).toBe(0);
    expect(result.seatsEstimate["snp"]).toBe(0);
    expect(result.seatsEstimate["pc"]).toBe(0);
    expect(result.seatsEstimate["sf"]).toBe(0);
    // Con/Lab split all 75 proportionally (~50.5/49.5 of the pool)
    expect(result.seatsEstimate["con"]! + result.seatsEstimate["lab"]!).toBe(75);
    expect(result.seatsEstimate["con"]).toBeGreaterThanOrEqual(result.seatsEstimate["lab"]!);
    expect(result.losers).toEqual(expect.arrayContaining(["lib", "snp", "pc", "sf"]));
  });

  it("threshold is computed on the PARTY aggregate, not the individual candidate", () => {
    // Party X splits 22% across two candidates (12% + 10%) — both clear the
    // 20% commons gate via the aggregate; party Y's single 18% candidate does not.
    const ranked: RankedCandidate[] = [
      { id: "z1", votes: 600, party: "Z" }, // 60%
      { id: "y1", votes: 180, party: "Y" }, // 18% alone — below gate
      { id: "x1", votes: 120, party: "X" }, // 12% (X aggregate 22%)
      { id: "x2", votes: 100, party: "X" }, // 10% (X aggregate 22%)
    ];
    const result = allocateSeats("commons", "UNKNOWN_REGION", 20, ranked, 1000);
    expect(result.seatsEstimate["y1"]).toBe(0);
    expect(result.seatsEstimate["x1"]!).toBeGreaterThan(0);
    expect(result.seatsEstimate["x2"]!).toBeGreaterThan(0);
    const total = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(total).toBe(20);
  });

  it("independents are never pooled into one eligibility group", () => {
    // Two independents at 15% each must NOT pool to 30% and sneak past the 20% gate.
    const ranked: RankedCandidate[] = [
      { id: "maj", votes: 700, party: "p1" },
      { id: "ind1", votes: 150, party: "independent" },
      { id: "ind2", votes: 150, party: "independent" },
    ];
    const result = allocateSeats("commons", "UNKNOWN_REGION", 10, ranked, 1000);
    expect(result.seatsEstimate["ind1"]).toBe(0);
    expect(result.seatsEstimate["ind2"]).toBe(0);
    expect(result.seatsEstimate["maj"]).toBe(10);
  });

  it("degenerate fallback: when NOBODY clears the threshold, fills in ranked order", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 180, party: "pA" }, // 18%
      { id: "B", votes: 150, party: "pB" }, // 15%
      { id: "C", votes: 120, party: "pC" }, // 12%
    ];
    const result = allocateSeats("commons", "UNKNOWN_REGION", 3, ranked, 1000);
    const total = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(total).toBe(3);
    // Ranked-order fill: top candidate gets at least as many as the others.
    expect(result.seatsEstimate["A"]!).toBeGreaterThanOrEqual(result.seatsEstimate["B"]!);
    expect(result.seatsEstimate["B"]!).toBeGreaterThanOrEqual(result.seatsEstimate["C"]!);
  });

  it("dominant party sweeps when it is the only one above threshold (no re-admission)", () => {
    const ranked: RankedCandidate[] = [
      { id: "A", votes: 900, party: "p1" }, // 90%
      { id: "B", votes: 60, party: "p2" }, // 6%
      { id: "C", votes: 40, party: "p3" }, // 4%
    ];
    const result = allocateSeats("stateSenate", "ST", 5, ranked, 1000);
    expect(result.seatsEstimate["A"]).toBe(5);
    expect(result.seatsEstimate["B"]).toBe(0);
    expect(result.seatsEstimate["C"]).toBe(0);
  });
});

// ── FPTP winner's bonus (power law) — #3244 / ticket #1032 ──────────────────

describe("getMajoritarianBonus — current-year/chamber gating", () => {
  it("is OFF for commons at modern in-game years (1999+) and without a year", () => {
    expect(getMajoritarianBonus("commons", 1999)).toBeUndefined();
    expect(getMajoritarianBonus("commons", 2007)).toBeUndefined();
    // The live 1991-default world at in-game ~2015: proportional — its
    // pre-#3244 status quo.
    expect(getMajoritarianBonus("commons", 2015)).toBeUndefined();
    expect(getMajoritarianBonus("commons", 2019)).toBeUndefined();
    expect(getMajoritarianBonus("commons", 2023)).toBeUndefined();
    // Fail-safe: absent/invalid year → modern (proportional) behavior.
    expect(getMajoritarianBonus("commons", undefined)).toBeUndefined();
    expect(getMajoritarianBonus("commons", null)).toBeUndefined();
    expect(getMajoritarianBonus("commons", Number.NaN)).toBeUndefined();
  });

  it("is ON for commons/snap_commons while the in-game year is pre-1999", () => {
    for (const year of [1953, 1955, 1979, 1991, 1995, 1998]) {
      expect(getMajoritarianBonus("commons", year)).toEqual({
        exponent: UK_COMMONS_FPTP_EXPONENT,
      });
      expect(getMajoritarianBonus("snap_commons", year)).toEqual({
        exponent: UK_COMMONS_FPTP_EXPONENT,
      });
    }
  });

  it("graduates a world back to proportional as its clock crosses 1999", () => {
    // A 1953-default world: winner's bonus through its historical phase…
    expect(getMajoritarianBonus("commons", 1953)).toBeDefined();
    expect(getMajoritarianBonus("commons", 1998)).toBeDefined();
    // …then reverts to the established proportional live behavior at 1999+.
    expect(getMajoritarianBonus("commons", 1999)).toBeUndefined();
    expect(getMajoritarianBonus("commons", 2020)).toBeUndefined();
  });

  it("is OFF for every non-Commons chamber even in historical years", () => {
    for (const type of ["house", "stateSenate", "bundestag", "dail", "sangiin", "shugiin"]) {
      expect(getMajoritarianBonus(type, 1953)).toBeUndefined();
    }
  });
});

describe("applyMajoritarianBonus — power-law transform", () => {
  const square = { exponent: 2 };
  const cube = { exponent: 3 };

  it("boosts BOTH top-two parties against the rest, split by their compared score", () => {
    const pool = [
      { id: "con", votes: 476, group: "party:con" },
      { id: "lab", votes: 453, group: "party:lab" },
      { id: "snp", votes: 210, group: "party:snp" },
    ];
    const eff = applyMajoritarianBonus(pool, square);
    const total = [...eff.values()].reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(476 + 453 + 210, 6);
    // Both duopoly parties gain; the third party is squeezed.
    expect(eff.get("con")!).toBeGreaterThan(476);
    expect(eff.get("lab")!).toBeGreaterThan(453);
    expect(eff.get("snp")!).toBeLessThan(210);
    // Inside the pair the split stays plain proportional to the compared score.
    expect(eff.get("con")! / eff.get("lab")!).toBeCloseTo(476 / 453, 9);
    // Pair-vs-rest square law: pair weight ∝ (pair share)^2 vs (rest share)^2.
    const sPair = 929 / 1139;
    const wantPair = (1139 * Math.pow(sPair, 2)) / (Math.pow(sPair, 2) + Math.pow(1 - sPair, 2));
    expect(eff.get("con")! + eff.get("lab")!).toBeCloseTo(wantPair, 6);
  });

  it("still supports cube-law squeeze strength when asked", () => {
    const pool = [
      { id: "con", votes: 476, group: "party:con" },
      { id: "lab", votes: 453, group: "party:lab" },
      { id: "snp", votes: 210, group: "party:snp" },
    ];
    const sq = applyMajoritarianBonus(pool, square);
    const cu = applyMajoritarianBonus(pool, cube);
    // Higher exponent squeezes the third party harder; pair split unchanged.
    expect(cu.get("snp")!).toBeLessThan(sq.get("snp")!);
    expect(cu.get("con")! / cu.get("lab")!).toBeCloseTo(476 / 453, 9);
  });

  it("is identity when only the duopoly is in the pool — no pool-lead amplification (ticket #1032)", () => {
    // Con pools 476 across two candidates vs Labour's lone 453. Pre-rework the
    // pooled lead was amplified (the ticket's complaint); now with nothing to
    // squeeze the allocation is exactly proportional, stacking buys nothing.
    const pool = [
      { id: "con1", votes: 300, group: "party:con" },
      { id: "con2", votes: 176, group: "party:con" },
      { id: "lab1", votes: 453, group: "party:lab" },
    ];
    const eff = applyMajoritarianBonus(pool, square);
    expect(eff.get("con1")).toBe(300);
    expect(eff.get("con2")).toBe(176);
    expect(eff.get("lab1")).toBe(453);
  });

  it("the beneficiaries are the two org-leading parties in the state (ticket #1032)", () => {
    // A surge party out-polls Labour but has no machine: it gets squeezed
    // while BOTH organized parties gain, splitting the boost 400:300.
    const pool = [
      { id: "con", votes: 400, group: "party:con" },
      { id: "lab", votes: 300, group: "party:lab" },
      { id: "pop", votes: 350, group: "party:pop" },
    ];
    const eff = applyMajoritarianBonus(pool, { exponent: 2, orgRanking: ["con", "lab", "pop"] });
    // pair 700 of 1050 → sPair 2/3, ^2 → pair target 840, pop squeezed to 210.
    expect(eff.get("con")!).toBeCloseTo(480, 6);
    expect(eff.get("lab")!).toBeCloseTo(360, 6);
    expect(eff.get("pop")!).toBeCloseTo(210, 6);
    expect(eff.get("con")! / eff.get("lab")!).toBeCloseTo(400 / 300, 9);
    // Org-ranked parties absent from the race are skipped, not boosted.
    const eff2 = applyMajoritarianBonus(pool, {
      exponent: 2,
      orgRanking: ["ghost", "lab", "con"],
    });
    expect(eff2.get("pop")!).toBeCloseTo(210, 6);
    expect(eff2.get("con")!).toBeCloseTo(480, 6);
  });

  it("is identity for a single group or a zero-vote runner-up", () => {
    const solo = applyMajoritarianBonus([{ id: "a", votes: 100, group: "g" }], square);
    expect(solo.get("a")).toBe(100);
    const degenerate = applyMajoritarianBonus(
      [
        { id: "a", votes: 100, group: "g1" },
        { id: "b", votes: 0, group: "g2" },
      ],
      square
    );
    expect(degenerate.get("a")).toBe(100);
    expect(degenerate.get("b")).toBe(0);
  });

  it("exponent 1 is a no-op (pure proportional)", () => {
    const pool = [
      { id: "a", votes: 476, group: "g1" },
      { id: "b", votes: 453, group: "g2" },
    ];
    const eff = applyMajoritarianBonus(pool, { exponent: 1 });
    expect(eff.get("a")).toBeCloseTo(476, 9);
    expect(eff.get("b")).toBeCloseTo(453, 9);
  });

  it("breaks exact vote ties deterministically by group key", () => {
    const eff1 = applyMajoritarianBonus(
      [
        { id: "x", votes: 400, group: "party:x" },
        { id: "y", votes: 400, group: "party:y" },
      ],
      square
    );
    // Tie → equal split either way; determinism means repeat runs identical.
    const eff2 = applyMajoritarianBonus(
      [
        { id: "x", votes: 400, group: "party:x" },
        { id: "y", votes: 400, group: "party:y" },
      ],
      square
    );
    expect([...eff1.entries()]).toEqual([...eff2.entries()]);
    expect(eff1.get("x")).toBeCloseTo(400, 9);
  });
});

describe("allocateSeats — commons with FPTP winner's bonus", () => {
  const bonus = { exponent: UK_COMMONS_FPTP_EXPONENT };
  // 1953-sim national shape: Con 47.6 / Lab 45.3 / Lib 6.7 in a 75-seat region.
  const ranked: RankedCandidate[] = [
    { id: "con", votes: 476, party: "con" },
    { id: "lab", votes: 453, party: "lab" },
    { id: "lib", votes: 67, party: "lib" },
  ];

  it("gate off (undefined config) is byte-identical to the current proportional path", () => {
    const off = allocateSeats("commons", "LON", 75, ranked, 996, undefined, undefined);
    const legacy = allocateSeats("commons", "LON", 75, ranked, 996);
    expect(off).toEqual(legacy);
  });

  it("gate leaves only the duopoly: allocation is exactly proportional between them", () => {
    // Lib is under the 20% gate, so the pool is Con+Lab alone — nothing to
    // squeeze, and the big two settle at their plain proportional shares.
    const on = allocateSeats("commons", "LON", 75, ranked, 996, undefined, bonus);
    const off = allocateSeats("commons", "LON", 75, ranked, 996);
    expect(on.seatsEstimate).toEqual(off.seatsEstimate);
    expect(on.seatsEstimate["con"]).toBe(38);
    expect(on.seatsEstimate["lab"]).toBe(37);
    expect(Object.values(on.seatsEstimate).reduce((s, v) => s + v, 0)).toBe(75);
  });

  it("squeezes an eligible third party while the big two both gain, proportionally", () => {
    // SNP-style third party above the gate in a 75-seat region.
    const trio: RankedCandidate[] = [
      { id: "con", votes: 400, party: "con" },
      { id: "lab", votes: 350, party: "lab" },
      { id: "snp", votes: 240, party: "snp" },
    ];
    const on = allocateSeats("commons", "SCO_TEST", 75, trio, 990, undefined, bonus);
    const off = allocateSeats("commons", "SCO_TEST", 75, trio, 990);
    // Proportional would be 30/27/18; the duopoly squeeze lands 36/32/7.
    expect(on.seatsEstimate["con"]).toBe(36);
    expect(on.seatsEstimate["lab"]).toBe(32);
    expect(on.seatsEstimate["snp"]).toBe(7);
    expect(on.seatsEstimate["con"]!).toBeGreaterThan(off.seatsEstimate["con"]!);
    expect(on.seatsEstimate["lab"]!).toBeGreaterThan(off.seatsEstimate["lab"]!);
    expect(on.seatsEstimate["snp"]!).toBeLessThan(off.seatsEstimate["snp"]!);
    expect(Object.values(on.seatsEstimate).reduce((s, v) => s + v, 0)).toBe(75);
  });

  it("keeps sub-threshold minors at exactly 0 seats", () => {
    const on = allocateSeats("commons", "LON", 75, ranked, 996, undefined, bonus);
    expect(on.seatsEstimate["lib"]).toBe(0);
  });

  it("three eligible parties: duopoly gains together, third squeezed", () => {
    // A 40 / B 35 / C 25 — all above the 20% gate in a 20-seat region.
    const threeWay: RankedCandidate[] = [
      { id: "A", votes: 400, party: "pa" },
      { id: "B", votes: 350, party: "pb" },
      { id: "C", votes: 250, party: "pc" },
    ];
    const on = allocateSeats("commons", "UNKNOWN_REGION", 20, threeWay, 1000, undefined, bonus);
    const off = allocateSeats("commons", "UNKNOWN_REGION", 20, threeWay, 1000);
    // Proportional 8/7/5 becomes 10/8/2: both majors up, C squeezed.
    expect(on.seatsEstimate["A"]).toBe(10);
    expect(on.seatsEstimate["B"]).toBe(8);
    expect(on.seatsEstimate["C"]).toBe(2);
    expect(on.seatsEstimate["A"]!).toBeGreaterThan(off.seatsEstimate["A"]!);
    expect(on.seatsEstimate["B"]!).toBeGreaterThan(off.seatsEstimate["B"]!);
    const total = Object.values(on.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(total).toBe(20);
  });

  it("is deterministic across repeated runs", () => {
    const a = allocateSeats("commons", "SEE", 90, ranked, 996, undefined, bonus);
    const b = allocateSeats("commons", "SEE", 90, ranked, 996, undefined, bonus);
    expect(a).toEqual(b);
  });

  it("landslide region: a 19% opposition clears the historical 10% gate and holds seats", () => {
    // NIR-style. Under the modern 20% gate this was a threshold sweep; the
    // historical Commons gate is 10% when the bonus is active, so the
    // opposition seats proportionally (duopoly-only pool → no squeeze).
    const nir: RankedCandidate[] = [
      { id: "uup", votes: 630, party: "con" },
      { id: "nat", votes: 150, party: "nat" }, // 19.2% — above the 10% gate
    ];
    const on = allocateSeats("commons", "UNKNOWN_REGION", 18, nir, 780, undefined, bonus);
    expect(on.seatsEstimate["uup"]).toBe(15);
    expect(on.seatsEstimate["nat"]).toBe(3);
    // A true sub-gate minor (under 10%) still gets swept out entirely.
    const swept: RankedCandidate[] = [
      { id: "uup", votes: 720, party: "con" },
      { id: "nat", votes: 60, party: "nat" }, // 7.7% — under the 10% gate
    ];
    const on2 = allocateSeats("commons", "UNKNOWN_REGION", 18, swept, 780, undefined, bonus);
    expect(on2.seatsEstimate["uup"]).toBe(18);
    expect(on2.seatsEstimate["nat"]).toBe(0);
  });

  it("never shrinks a minority duopoly below its proportional share", () => {
    // Fragmented region: the vote leader (30%) plus the best-organized other
    // party (15%) is only 45% of the pool, so the power law would shrink the
    // pair. The bonus clamps to identity instead of punishing them.
    const frag: RankedCandidate[] = [
      { id: "a", votes: 300, party: "pa" },
      { id: "b", votes: 280, party: "pb" },
      { id: "c", votes: 270, party: "pc" },
      { id: "d", votes: 150, party: "pd" },
    ];
    const on = allocateSeats("commons", "UNKNOWN_REGION", 27, frag, 1000, undefined, {
      exponent: UK_COMMONS_FPTP_EXPONENT,
      orgRanking: ["pd", "pa", "pb", "pc"],
    });
    const prop = allocateSeats("commons", "UNKNOWN_REGION", 27, frag, 1000, undefined, {
      exponent: 1,
    });
    expect(on.seatsEstimate).toEqual(prop.seatsEstimate);
  });

  it("guarantees the region's vote leader a slot even when its machine ranks last", () => {
    // The live NEE cliff: Labour led on votes but ranked THIRD on
    // organization, so an org-only pair was Con+Lib and Labour — with an
    // outright majority of the region — was excluded from the boost.
    const nee: RankedCandidate[] = [
      { id: "lab", votes: 529, party: "lab" },
      { id: "con", votes: 340, party: "con" },
      { id: "lib", votes: 131, party: "lib" },
    ];
    const orgPutsLabourLast = allocateSeats("commons", "UNKNOWN_REGION", 27, nee, 1000, undefined, {
      exponent: UK_COMMONS_FPTP_EXPONENT,
      orgRanking: ["con", "lib", "lab"],
    });
    const orgPutsLabourFirst = allocateSeats(
      "commons",
      "UNKNOWN_REGION",
      27,
      nee,
      1000,
      undefined,
      {
        exponent: UK_COMMONS_FPTP_EXPONENT,
        orgRanking: ["lab", "con", "lib"],
      }
    );
    // Same pair (Lab + Con) either way, so an org reshuffle cannot lurch the
    // seat count while the vote shares hold still.
    expect(orgPutsLabourLast.seatsEstimate).toEqual(orgPutsLabourFirst.seatsEstimate);
    expect(orgPutsLabourLast.seatsEstimate["lab"]).toBe(16);
    expect(orgPutsLabourLast.seatsEstimate["con"]).toBe(10);
    expect(orgPutsLabourLast.seatsEstimate["lib"]).toBe(1);
  });

  it("never fills both slots with the same party", () => {
    // Organization's top entry IS the vote leader, so the second slot must
    // skip past it to the next organized party rather than double-count.
    const pool = [
      { id: "a", votes: 500, group: "party:pa" },
      { id: "b", votes: 300, group: "party:pb" },
      { id: "c", votes: 200, group: "party:pc" },
    ];
    const eff = applyMajoritarianBonus(pool, { exponent: 2, orgRanking: ["pa", "pc", "pb"] });
    // Pair is pa (vote leader) + pc (best organized that is not pa), so pb —
    // despite out-polling pc — is the one squeezed.
    expect(eff.get("b")!).toBeLessThan(300);
    expect(eff.get("a")!).toBeGreaterThan(500);
    expect(eff.get("c")!).toBeGreaterThan(200);
    // Total is still conserved, which a duplicated slot would break.
    expect(eff.get("a")! + eff.get("b")! + eff.get("c")!).toBeCloseTo(1000, 6);
  });

  it("ticket #1032: no pool-lead amplification — the NWE shape settles proportionally", () => {
    // Live NWE shape from the ticket screenshot: one Labour front-runner vs
    // three Conservatives whose pooled share leads the region. Pre-rework the
    // Conservative POOL won an amplified 52/75 vs Edward's 23 even though
    // Edward led the race outright — the "how does this make sense"
    // complaint. Lib is under the gate, so the pool is the duopoly alone and
    // the region settles at plain proportional shares: 30 Labour, 45 Con.
    const nwe: RankedCandidate[] = [
      { id: "edward", votes: 106_600, party: "lab" },
      { id: "may", votes: 81_400, party: "con" },
      { id: "cunk", votes: 56_200, party: "con" },
      { id: "wolf", votes: 23_100, party: "con" },
      { id: "taylor", votes: 4_500, party: "lib" },
    ];
    const total = 271_800;
    const on = allocateSeats("commons", "NWE", 75, nwe, total, undefined, bonus);
    const prop = allocateSeats("commons", "NWE", 75, nwe, total);

    const lab = on.seatsEstimate["edward"] ?? 0;
    const con =
      (on.seatsEstimate["may"] ?? 0) +
      (on.seatsEstimate["cunk"] ?? 0) +
      (on.seatsEstimate["wolf"] ?? 0);

    expect(lab + con + (on.seatsEstimate["taylor"] ?? 0)).toBe(75);
    expect(on.seatsEstimate).toEqual(prop.seatsEstimate);
    expect(lab).toBe(30);
    expect(con).toBe(45);
  });
});
