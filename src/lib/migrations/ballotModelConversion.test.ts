import { describe, expect, it } from "vitest";
import { turnVoteWeight } from "@/lib/electionEngine/voteCalculations";
import type { VoteTurnSnapshot } from "@/lib/db/types/voteTally";
import {
  carryTotals,
  generalSliceFactor,
  replayPrimaryBallots,
  rescaleSnapshotIncrements,
  selectWindowSnapshots,
} from "./ballotModelConversion";

const at = (turn: number): Date => new Date(Date.UTC(2026, 7, 28, turn));

function snap(turn: number, cumulativeVotes: Record<string, number>): VoteTurnSnapshot {
  const total = Object.values(cumulativeVotes).reduce((s, v) => s + v, 0);
  const sharesPct: Record<string, number> = {};
  for (const [id, v] of Object.entries(cumulativeVotes)) {
    sharesPct[id] = total > 0 ? Math.round((v / total) * 1000) / 10 : 0;
  }
  return { turn, recordedAt: at(turn), cumulativeVotes, sharesPct };
}

describe("generalSliceFactor", () => {
  it("shrinks the early band by the extra slice and leaves the final band alone", () => {
    // 48-turn general: old early band was 36 turns of 50%, new is 37.
    expect(generalSliceFactor(48, 0)).toBeCloseTo(36 / 37, 10);
    // The old final band began at index 44; index 44 is now the last ramp turn.
    expect(generalSliceFactor(48, 44)).toBeCloseTo(
      turnVoteWeight(49, 44, 1) / turnVoteWeight(48, 44, 1),
      10
    );
    // The old clamped 13th slice of a 12-turn window becomes a fresh final slice.
    expect(generalSliceFactor(12, 12)).toBeCloseTo(1, 10);
  });

  it("integrates the old series to exactly one new pool", () => {
    // Old engine: turns 0..gen (gen+1 accruals, the last clamped). Rescaled,
    // they must sum to one pool of the inclusive window.
    const gen = 24;
    let sum = 0;
    for (let i = 0; i <= gen; i++) {
      sum += turnVoteWeight(gen, Math.min(i, gen - 1), 1) * generalSliceFactor(gen, i);
    }
    expect(sum).toBeCloseTo(1, 10);
  });
});

describe("rescaleSnapshotIncrements", () => {
  it("rescales each turn's increments and re-sums, leaving per-turn shares intact", () => {
    const series = [snap(1, { a: 600, b: 400 }), snap(2, { a: 1200, b: 800 })];
    const { snapshots, totals } = rescaleSnapshotIncrements(series, (_t, i) => (i === 0 ? 0.5 : 1));
    expect(snapshots[0].cumulativeVotes).toEqual({ a: 300, b: 200 });
    expect(snapshots[1].cumulativeVotes).toEqual({ a: 900, b: 600 });
    expect(snapshots[1].sharesPct).toEqual({ a: 60, b: 40 });
    expect(totals).toEqual({ a: 900, b: 600 });
  });

  it("removes a re-run turn's slice from the running total, not just its record", () => {
    // Turn 460 banked three times (live 2026-08-28): the later two attempts'
    // increments sit inside every later cumulative and must come out.
    const series = [
      snap(459, { a: 100 }),
      snap(460, { a: 200 }),
      snap(460, { a: 300 }),
      snap(460, { a: 400 }),
      snap(461, { a: 500 }),
    ];
    const { snapshots, totals, dropped } = rescaleSnapshotIncrements(series, () => 1);
    expect(dropped).toBe(2);
    expect(snapshots.map((s) => s.turn)).toEqual([459, 460, 461]);
    expect(snapshots.map((s) => s.cumulativeVotes.a)).toEqual([100, 200, 300]);
    expect(totals.a).toBe(300);
  });

  it("drops a withdrawn candidate the way the engine does", () => {
    const series = [snap(1, { a: 100, b: 100 }), snap(2, { a: 250 })];
    const { snapshots } = rescaleSnapshotIncrements(series, () => 1);
    expect(snapshots[1].cumulativeVotes).toEqual({ a: 250 });
  });

  it("squeezes a turn that would carry the total past the electorate ceiling", () => {
    const series = [snap(1, { a: 600, b: 400 }), snap(2, { a: 1200, b: 800 })];
    const { totals } = rescaleSnapshotIncrements(series, () => 1, 1_500);
    expect(totals.a + totals.b).toBe(1_500);
    // Shares survive the squeeze.
    expect(totals.a / (totals.a + totals.b)).toBeCloseTo(0.6, 6);
  });
});

describe("carryTotals", () => {
  it("takes rebuilt figures for listed keys and scales the rest by the same ratio", () => {
    const out = carryTotals(
      { a: 1000, b: 500, gone: 200 },
      { a: 1000, b: 500 },
      { a: 800, b: 400 }
    );
    expect(out).toEqual({ a: 800, b: 400, gone: 160 });
  });
});

describe("selectWindowSnapshots", () => {
  it("buckets by hour, keeps the newest record per hour, and numbers the newest as the last turn", () => {
    const records = [
      { recordedAt: at(10), tag: "t10" },
      { recordedAt: at(11), tag: "t11" },
      { recordedAt: new Date(at(12).getTime() + 30 * 60_000), tag: "t12-rerun" },
      { recordedAt: at(12), tag: "t12" },
      { recordedAt: at(13), tag: "t13" },
    ];
    const picked = selectWindowSnapshots(records, 3, 11);
    expect(picked.map((p) => [p.snapshot.tag, p.turn])).toEqual([
      ["t11", 11],
      ["t12-rerun", 12],
      ["t13", 13],
    ]);
  });

  it("numbers a short history onto the most recent turns", () => {
    const picked = selectWindowSnapshots([{ recordedAt: at(5) }, { recordedAt: at(6) }], 4, 3);
    expect(picked.map((p) => p.turn)).toEqual([5, 6]);
  });
});

describe("replayPrimaryBallots", () => {
  it("accrues one slice per elapsed turn at the window's own index", () => {
    const entries = new Map([
      [
        "1",
        [
          { candidateId: "a", sharePct: 75 },
          { candidateId: "b", sharePct: 25 },
        ],
      ],
    ]);
    const totalTurns = 12;
    const pools = new Map([["1", 120_000]]);
    const cumulative = replayPrimaryBallots({
      cumulative: {},
      turns: [0, 1, 2].map((turnIndex) => ({ turnIndex, entriesByParty: entries })),
      poolsByParty: pools,
      totalTurns,
    });
    const expected = [0, 1, 2].reduce((s, i) => s + turnVoteWeight(totalTurns, i, 120_000), 0);
    expect(cumulative.a + cumulative.b).toBeCloseTo(expected, -1);
    expect(cumulative.a / (cumulative.a + cumulative.b)).toBeCloseTo(0.75, 2);
  });
});
