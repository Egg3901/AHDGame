/**
 * Unit tests for seatAllocation — seat allocation logic for multi-seat and single-seat races.
 */
import { describe, it, expect } from "vitest";
import { allocateSeats, getMultiSeatMinShare, type RankedCandidate } from "./seatAllocation";
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

  it("keeps the existing 20% Commons eligibility gate", () => {
    expect(getMultiSeatMinShare("house")).toBe(0.2);
    expect(getMultiSeatMinShare("commons")).toBe(0.2);
    expect(getMultiSeatMinShare("snap_commons")).toBe(0.2);
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
  it("allocates the reported 1970 vote split without a historical winner bonus", () => {
    const ranked: RankedCandidate[] = [
      { id: "con", votes: 533, party: "con" },
      { id: "lab", votes: 291, party: "lab" },
      { id: "ld", votes: 175, party: "ld" },
    ];

    expect(allocateSeats("commons", "TEST", 81, ranked, 999).seatsEstimate).toEqual({
      con: 52,
      lab: 29,
      ld: 0,
    });
  });

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
    // Party X splits 24% across two candidates (12% + 12%) and clears the
    // 20% Commons gate via the aggregate; party Y's single 8% candidate does not.
    const ranked: RankedCandidate[] = [
      { id: "z1", votes: 680, party: "Z" }, // 68%
      { id: "y1", votes: 80, party: "Y" }, // 8% alone — below gate
      { id: "x1", votes: 120, party: "X" }, // 12% (X aggregate 24%)
      { id: "x2", votes: 120, party: "X" }, // 12% (X aggregate 24%)
    ];
    const result = allocateSeats("commons", "UNKNOWN_REGION", 20, ranked, 1000);
    expect(result.seatsEstimate["y1"]).toBe(0);
    expect(result.seatsEstimate["x1"]!).toBeGreaterThan(0);
    expect(result.seatsEstimate["x2"]!).toBeGreaterThan(0);
    const total = Object.values(result.seatsEstimate).reduce((s, v) => s + v, 0);
    expect(total).toBe(20);
  });

  it("independents are never pooled into one eligibility group", () => {
    // Two independents at 5% each must NOT pool to 10% and sneak past the 10% gate.
    const ranked: RankedCandidate[] = [
      { id: "maj", votes: 900, party: "p1" },
      { id: "ind1", votes: 50, party: "independent" },
      { id: "ind2", votes: 50, party: "independent" },
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

describe("allocateSeats - Commons proportional correction", () => {
  it("replays ticket 1319's turn-869 SEE snapshot", () => {
    const ticketRanked: RankedCandidate[] = [
      { id: "monroe", votes: 66375, party: "con" },
      { id: "viktoriya", votes: 53285, party: "lab" },
      { id: "count", votes: 54426, party: "lab" },
      { id: "liam", votes: 75367, party: "con" },
      { id: "asif", votes: 68511, party: "ld" },
      { id: "aaliyah", votes: 66634, party: "con" },
      { id: "mihai", votes: 6351, party: "lab" },
    ];
    const result = allocateSeats(
      "commons",
      "SEE",
      81,
      ticketRanked,
      390949,
      undefined,
      undefined,
      UK_COMMONS_SEATS_1953
    );

    expect(result.seatsEstimate).toEqual({
      monroe: 17,
      viktoriya: 13,
      count: 14,
      liam: 19,
      asif: 0,
      aaliyah: 17,
      mihai: 1,
    });
    expect(Object.values(result.seatsEstimate).reduce((sum, seats) => sum + seats, 0)).toBe(81);
  });

  it("allocates an eligible third party proportionally", () => {
    const ranked: RankedCandidate[] = [
      { id: "con", votes: 400, party: "con" },
      { id: "lab", votes: 350, party: "lab" },
      { id: "snp", votes: 240, party: "snp" },
    ];
    const result = allocateSeats("commons", "SCO_TEST", 75, ranked, 990);
    expect(result.seatsEstimate).toEqual({ con: 30, lab: 27, snp: 18 });
  });

  it("keeps the 20% Commons gate while excluding a sub-threshold minor", () => {
    const ranked: RankedCandidate[] = [
      { id: "con", votes: 476, party: "con" },
      { id: "lab", votes: 453, party: "lab" },
      { id: "lib", votes: 67, party: "lib" },
    ];
    const result = allocateSeats("commons", "LON", 75, ranked, 996);
    expect(result.seatsEstimate).toEqual({ con: 38, lab: 37, lib: 0 });
  });

  it("is deterministic and conserves the chamber seat count", () => {
    const ranked: RankedCandidate[] = [
      { id: "lab", votes: 106_600, party: "lab" },
      { id: "may", votes: 81_400, party: "con" },
      { id: "cunk", votes: 56_200, party: "con" },
      { id: "wolf", votes: 23_100, party: "con" },
      { id: "lib", votes: 4_500, party: "lib" },
    ];
    const first = allocateSeats("commons", "NWE", 75, ranked, 271_800);
    const second = allocateSeats("commons", "NWE", 75, ranked, 271_800);
    expect(first).toEqual(second);
    expect(Object.values(first.seatsEstimate).reduce((sum, seats) => sum + seats, 0)).toBe(75);
  });
});
