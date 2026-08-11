import { describe, it, expect } from "vitest";
import {
  distributeSubdivisionVotes,
  assignSeatConsistentWinners,
  assignByLeanOrdering,
  formatLeanLabel,
} from "./subdivisionResults";

describe("formatLeanLabel", () => {
  it("labels exactly-zero lean as Even, not Right +0.0 (issue #3320)", () => {
    const r = formatLeanLabel(0);
    expect(r.label).toBe("Even");
    expect(r.neutral).toBe(true);
  });

  it("treats near-zero magnitudes within epsilon as Even", () => {
    expect(formatLeanLabel(0.4).label).toBe("Even");
    expect(formatLeanLabel(-0.4).label).toBe("Even");
  });

  it("labels negative lean as Left", () => {
    const r = formatLeanLabel(-12.3);
    expect(r.label).toBe("Left +12.3");
    expect(r.neutral).toBe(false);
  });

  it("labels positive lean as Right", () => {
    const r = formatLeanLabel(8.5);
    expect(r.label).toBe("Right +8.5");
    expect(r.neutral).toBe(false);
  });

  it("respects the epsilon boundary (>= epsilon is not Even)", () => {
    expect(formatLeanLabel(0.5).label).toBe("Right +0.5");
    expect(formatLeanLabel(-0.5).label).toBe("Left +0.5");
  });

  it("treats non-finite lean as Even defensively", () => {
    expect(formatLeanLabel(NaN).label).toBe("Even");
  });
});

describe("distributeSubdivisionVotes", () => {
  // Scotland-like fixture: SNP has baseline only in subdivisions S1/S2.
  const subdivisions = [
    {
      id: "S1",
      name: "SubA",
      electorate: 100000,
      leanScalar: -10,
      partyShares: { LAB: 0.3, CON: 0.2, SNP: 0.4 },
    },
    {
      id: "S2",
      name: "SubB",
      electorate: 100000,
      leanScalar: 0,
      partyShares: { LAB: 0.4, CON: 0.3, SNP: 0.2 },
    },
    {
      id: "S3",
      name: "SubC",
      electorate: 200000,
      leanScalar: 10,
      partyShares: { LAB: 0.3, CON: 0.5, SNP: 0 },
    },
  ];

  it("conserves totals exactly per candidate", () => {
    const regionVotes = { a: 40000, b: 35000, c: 25000 };
    const candidates = {
      a: { baselineKey: "LAB", econPosition: -2 },
      b: { baselineKey: "CON", econPosition: 2 },
      c: { baselineKey: "SNP", econPosition: -2 },
    };
    const result = distributeSubdivisionVotes(subdivisions, regionVotes, candidates);
    for (const cid of ["a", "b", "c"] as const) {
      expect(result.reduce((s, r) => s + r.votes[cid], 0)).toBe(regionVotes[cid]);
    }
  });

  it("concentrates baseline parties in their strongholds", () => {
    const regionVotes = { a: 40000, b: 35000, c: 25000 };
    const candidates = {
      a: { baselineKey: "LAB", econPosition: -2 },
      b: { baselineKey: "CON", econPosition: 2 },
      c: { baselineKey: "SNP", econPosition: -2 },
    };
    const result = distributeSubdivisionVotes(subdivisions, regionVotes, candidates);
    const s1 = result.find((r) => r.id === "S1")!;
    const s3 = result.find((r) => r.id === "S3")!;
    // SNP share in its stronghold (S1) must dwarf its share where baseline is 0 (S3)
    const share = (r: typeof s1, cid: string) =>
      r.votes[cid] / Object.values(r.votes).reduce((s, v) => s + v, 0);
    expect(share(s1, "c")).toBeGreaterThan(0.25);
    expect(share(s3, "c")).toBeLessThan(0.05);
  });

  it("falls back to scalar lean for candidates without a baseline", () => {
    const regionVotes = { left: 5000, right: 5000 };
    const candidates = {
      left: { econPosition: -3 }, // no baselineKey → scalar path
      right: { econPosition: 3 },
    };
    const result = distributeSubdivisionVotes(subdivisions, regionVotes, candidates);
    const s1 = result.find((r) => r.id === "S1")!; // leanScalar -10 → favors left
    const s3 = result.find((r) => r.id === "S3")!; // leanScalar +10 → favors right
    expect(s1.votes.left).toBeGreaterThan(s1.votes.right);
    expect(s3.votes.right).toBeGreaterThan(s3.votes.left);
  });

  it("treats a baseline party with zero mean share as scalar-fallback", () => {
    // PC has no share anywhere in this region → must not divide by zero
    const regionVotes = { a: 9000, b: 1000 };
    const candidates = {
      a: { baselineKey: "LAB", econPosition: -2 },
      b: { baselineKey: "PC", econPosition: -2 },
    };
    const result = distributeSubdivisionVotes(subdivisions, regionVotes, candidates);
    expect(result.reduce((s, r) => s + r.votes.b, 0)).toBe(1000);
    // and no NaN anywhere
    for (const r of result) {
      for (const v of Object.values(r.votes)) expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("returns [] on zero electorate or zero votes", () => {
    expect(distributeSubdivisionVotes([], { a: 100 }, { a: { econPosition: 0 } })).toEqual([]);
    expect(distributeSubdivisionVotes(subdivisions, {}, {})).toEqual([]);
  });
});

describe("assignSeatConsistentWinners", () => {
  const distributed = [
    { id: "S1", name: "A", votes: { x: 600, y: 400 }, margin: 20, winner: "x" },
    { id: "S2", name: "B", votes: { x: 550, y: 450 }, margin: 10, winner: "x" },
    { id: "S3", name: "C", votes: { x: 300, y: 700 }, margin: 40, winner: "y" },
    { id: "S4", name: "D", votes: { x: 450, y: 550 }, margin: 10, winner: "y" },
  ];

  it("gives each candidate exactly its seat count, strongest first", () => {
    // Proportional allocation said 1 seat each despite x leading 2 subdivisions
    const result = assignSeatConsistentWinners(distributed, { x: 1, y: 1 });
    const winners = Object.fromEntries(result.map((r) => [r.id, r.winner]));
    expect(winners.S1).toBe("x"); // x's strongest
    expect(winners.S3).toBe("y"); // y's strongest
    // remaining two vacant (seat total 2 < 4 subdivisions)
    expect(result.filter((r) => r.winner === "").length).toBe(2);
  });

  it("caps at subdivision count when seats exceed it (NWE case)", () => {
    const result = assignSeatConsistentWinners(distributed, { x: 3, y: 3 });
    expect(result.every((r) => r.winner !== "")).toBe(true);
  });

  it("is deterministic on share ties (id tiebreak)", () => {
    const tied = [
      { id: "T2", name: "B", votes: { x: 500, y: 500 }, margin: 0, winner: "x" },
      { id: "T1", name: "A", votes: { x: 500, y: 500 }, margin: 0, winner: "x" },
    ];
    const r1 = assignSeatConsistentWinners(tied, { x: 1, y: 1 });
    const r2 = assignSeatConsistentWinners([...tied].reverse(), { x: 1, y: 1 });
    expect(Object.fromEntries(r1.map((r) => [r.id, r.winner]))).toEqual(
      Object.fromEntries(r2.map((r) => [r.id, r.winner]))
    );
  });
});

describe("assignByLeanOrdering", () => {
  // Real-data parity with the deleted legacy assignCDSeats is pinned by
  // src/lib/maps/usCdParity.test.ts against captured fixture outputs.
  const subs = [
    { id: "ST-01", name: "ST-01", electorate: 0, leanScalar: -15 },
    { id: "ST-02", name: "ST-02", electorate: 0, leanScalar: -5 },
    { id: "ST-03", name: "ST-03", electorate: 0, leanScalar: 5 },
    { id: "ST-04", name: "ST-04", electorate: 0, leanScalar: 15 },
  ];

  it("fills left-most subdivisions with left-most parties, vacant tail", () => {
    const generic = assignByLeanOrdering(
      subs,
      { candA: 1, candB: 2 },
      { candA: "1", candB: "2" },
      { "1": -2, "2": 2 }
    );
    expect(generic).toEqual([
      { id: "ST-01", winner: "candA", party: "1", margin: 15 },
      { id: "ST-02", winner: "candB", party: "2", margin: 5 },
      { id: "ST-03", winner: "candB", party: "2", margin: 5 },
      { id: "ST-04", winner: "", party: "independent", margin: 0 },
    ]);
  });

  it("full assignment leaves no vacancies", () => {
    const generic = assignByLeanOrdering(
      subs,
      { candA: 2, candB: 2 },
      { candA: "1", candB: "2" },
      { "1": -2, "2": 2 }
    );
    expect(generic.map((r) => r.winner)).toEqual(["candA", "candA", "candB", "candB"]);
  });
});

describe("equal-weight subdivisions (RU no-baseline path)", () => {
  const equalSubs = Array.from({ length: 5 }, (_, i) => ({
    id: `u${i}`,
    name: `Unit ${i}`,
    electorate: 1,
    leanScalar: 0,
  }));

  it("distributes uniformly with exact conservation and no lean skew", () => {
    const regionVotes = { a: 700003, b: 299997 };
    const result = distributeSubdivisionVotes(equalSubs, regionVotes, {
      a: { econPosition: -4 },
      b: { econPosition: 0 },
    });
    expect(result.reduce((s, r) => s + r.votes.a, 0)).toBe(700003);
    expect(result.reduce((s, r) => s + r.votes.b, 0)).toBe(299997);
    // lean 0 → no shift: every unit sits within integer rounding plus the
    // largest-holder drift correction (≤ ~N/2 votes) of the uniform split.
    for (const r of result) {
      expect(Math.abs(r.votes.a - 700003 / 5)).toBeLessThanOrEqual(3);
      expect(r.winner).toBe("a");
    }
  });
});
