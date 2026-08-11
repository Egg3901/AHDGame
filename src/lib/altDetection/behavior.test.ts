import { describe, it, expect } from "vitest";
import {
  analyzeSessionInterleave,
  buildActivityRhythm,
  buildSessions,
  compareActivityRhythm,
  compareTargetSets,
  cosineSimilarity,
  jaccard,
  normalizedEntropy,
  MIN_RHYTHM_EVENTS,
  SESSION_GAP_MS,
} from "./behavior";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

/** `count` timestamps spread across `days` days, all at `hour` UTC. */
function dailyAt(hour: number, days: number, perDay: number, startDay = 0): Date[] {
  const base = Date.UTC(2026, 5, 1, hour, 0, 0);
  const out: Date[] = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < perDay; i++) {
      out.push(new Date(base + (startDay + d) * DAY_MS + i * MIN_MS));
    }
  }
  return out;
}

describe("cosineSimilarity", () => {
  it("is 1 for parallel vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 rather than NaN when either side is all-zero", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("returns 0 for mismatched lengths instead of comparing a prefix", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("normalizedEntropy", () => {
  it("is 0 when everything is in one bucket", () => {
    expect(normalizedEntropy([10, 0, 0, 0])).toBe(0);
  });

  it("is 1 when perfectly uniform", () => {
    expect(normalizedEntropy([5, 5, 5, 5])).toBeCloseTo(1, 10);
  });

  it("is 0 for an empty or single-bucket vector rather than NaN", () => {
    expect(normalizedEntropy([])).toBe(0);
    expect(normalizedEntropy([0, 0])).toBe(0);
    expect(normalizedEntropy([7])).toBe(0);
  });
});

describe("buildActivityRhythm", () => {
  it("buckets by UTC hour and day-of-week and counts the total", () => {
    const rhythm = buildActivityRhythm([
      new Date("2026-06-01T03:15:00Z"), // Monday, hour 3
      new Date("2026-06-01T03:45:00Z"),
      new Date("2026-06-02T20:00:00Z"), // Tuesday, hour 20
    ]);
    expect(rhythm.total).toBe(3);
    expect(rhythm.hours[3]).toBe(2);
    expect(rhythm.hours[20]).toBe(1);
    expect(rhythm.days[1]).toBe(2); // Monday
    expect(rhythm.days[2]).toBe(1); // Tuesday
  });

  it("skips invalid dates rather than poisoning the histogram", () => {
    const rhythm = buildActivityRhythm([new Date("2026-06-01T03:00:00Z"), new Date("nope")]);
    expect(rhythm.total).toBe(1);
  });
});

describe("compareActivityRhythm", () => {
  it("refuses to compare profiles below the event floor", () => {
    const sparse = buildActivityRhythm(dailyAt(3, 2, 2));
    expect(sparse.total).toBeLessThan(MIN_RHYTHM_EVENTS);
    const result = compareActivityRhythm(sparse, sparse);
    expect(result.comparable).toBe(false);
    expect(result.reason).toBe("insufficient_events");
  });

  it("refuses to compare DIFFUSE profiles even when they match closely", () => {
    // Two accounts both active evenly across all 24 hours. Their histograms
    // are near-identical, but that similarity is meaningless — this is the
    // false positive the entropy guard exists to prevent.
    const spread: Date[] = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let i = 0; i < 3; i++) {
        spread.push(new Date(Date.UTC(2026, 5, 1 + (i % 5), hour, 0, 0)));
      }
    }
    const rhythm = buildActivityRhythm(spread);
    const result = compareActivityRhythm(rhythm, rhythm);
    expect(result.combined).toBeGreaterThan(0.99);
    expect(result.comparable).toBe(false);
    expect(result.reason).toBe("diffuse_activity");
  });

  it("compares two concentrated profiles and scores an identical schedule near 1", () => {
    const a = buildActivityRhythm(dailyAt(2, 10, 4));
    const b = buildActivityRhythm(dailyAt(2, 10, 4));
    const result = compareActivityRhythm(a, b);
    expect(result.comparable).toBe(true);
    expect(result.combined).toBeGreaterThan(0.95);
  });

  it("scores two concentrated profiles in different windows well below the fire threshold", () => {
    const a = buildActivityRhythm(dailyAt(2, 10, 4));
    const b = buildActivityRhythm(dailyAt(15, 10, 4));
    const result = compareActivityRhythm(a, b);
    expect(result.comparable).toBe(true);
    // Day-of-week still matches (both play daily), so `combined` is not 0 —
    // but the hour component, which carries 80% of the weight, is 0.
    expect(result.hourSimilarity).toBe(0);
    expect(result.combined).toBeLessThan(0.5);
  });
});

describe("buildSessions", () => {
  it("splits on gaps larger than the session gap and sorts unsorted input", () => {
    const t0 = Date.UTC(2026, 5, 1, 10, 0, 0);
    const sessions = buildSessions([
      new Date(t0 + 10 * MIN_MS),
      new Date(t0),
      new Date(t0 + 5 * MIN_MS),
      new Date(t0 + SESSION_GAP_MS + 60 * MIN_MS), // well past the gap
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].start.getTime()).toBe(t0);
    expect(sessions[0].end.getTime()).toBe(t0 + 10 * MIN_MS);
  });

  it("returns an empty list for no timestamps", () => {
    expect(buildSessions([])).toEqual([]);
  });

  it("represents a lone event as a zero-length session", () => {
    const sessions = buildSessions([new Date("2026-06-01T10:00:00Z")]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].start.getTime()).toBe(sessions[0].end.getTime());
  });
});

describe("analyzeSessionInterleave", () => {
  /** A alternates with B: A runs for an hour, B starts 5 minutes later, and
   * so on — the single-operator signature. */
  function alternatingPair(cycles: number) {
    const base = Date.UTC(2026, 5, 1, 18, 0, 0);
    const aTimes: Date[] = [];
    const bTimes: Date[] = [];
    for (let i = 0; i < cycles; i++) {
      const cycleStart = base + i * DAY_MS;
      // A: 18:00-18:30
      aTimes.push(new Date(cycleStart), new Date(cycleStart + 30 * MIN_MS));
      // B: 18:35-19:05 — starts 5 min after A stops, never concurrent
      bTimes.push(new Date(cycleStart + 35 * MIN_MS), new Date(cycleStart + 65 * MIN_MS));
    }
    return { a: buildSessions(aTimes), b: buildSessions(bTimes) };
  }

  it("qualifies a clean alternating pattern with no concurrent time", () => {
    const { a, b } = alternatingPair(6);
    const result = analyzeSessionInterleave(a, b);
    expect(result.qualifies).toBe(true);
    expect(result.overlapMinutes).toBe(0);
    expect(result.handoffs).toBeGreaterThanOrEqual(4);
    expect(result.longestAlternation).toBeGreaterThanOrEqual(4);
  });

  it("rejects a pattern that hands off cleanly but ALSO has concurrent time", () => {
    // Two people who play together: their sessions do hand off (one picks
    // up as the other stops), which alone would look like alternation — but
    // they also overlap, which one person at one keyboard cannot do. This is
    // the case the overlap guard exists for, and it must survive a handoff
    // count that clears the floor.
    const base = Date.UTC(2026, 5, 1, 18, 0, 0);
    const aTimes: Date[] = [];
    const bTimes: Date[] = [];
    // Dense timestamps every 5 minutes across each interval — an interval
    // given only by its endpoints would itself split into two zero-length
    // sessions once the endpoints are more than the session gap apart.
    const fill = (out: Date[], day: number, fromMin: number, toMin: number) => {
      for (let m = fromMin; m <= toMin; m += 5) out.push(new Date(day + m * MIN_MS));
    };
    for (let d = 0; d < 3; d++) {
      const day = base + d * DAY_MS;
      // A: 18:00-18:20 and 19:00-19:20
      fill(aTimes, day, 0, 20);
      fill(aTimes, day, 60, 80);
      // B: 18:15-18:55 (overlaps A's first session by 5 min) and 19:30-20:10.
      // A's second session starts 5 min after B's first ends, and B's second
      // starts 10 min after A's second ends — two handoffs a day.
      fill(bTimes, day, 15, 55);
      fill(bTimes, day, 90, 130);
    }
    const result = analyzeSessionInterleave(buildSessions(aTimes), buildSessions(bTimes));
    expect(result.handoffs).toBeGreaterThanOrEqual(4);
    expect(result.overlapMinutes).toBeGreaterThan(0);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe("concurrent_activity");
  });

  it("rejects a pair with too few sessions even if every one of them hands off", () => {
    const { a, b } = alternatingPair(2);
    const result = analyzeSessionInterleave(a, b);
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe("too_few_sessions");
  });

  it("rejects sessions that are far apart in time and never hand off", () => {
    const aTimes = dailyAt(2, 6, 2);
    const bTimes = dailyAt(14, 6, 2); // 12h away — no handoff is possible
    const result = analyzeSessionInterleave(buildSessions(aTimes), buildSessions(bTimes));
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe("too_few_handoffs");
  });

  it("still qualifies zero-duration (single-event) sessions that alternate cleanly", () => {
    // A burner that logs in to take one action, alternating with the
    // operator, produces sessions with no measurable duration — and so no
    // possible overlap. That must not be mistaken for a missing check.
    const base = Date.UTC(2026, 5, 1, 18, 0, 0);
    const aTimes: Date[] = [];
    const bTimes: Date[] = [];
    for (let i = 0; i < 6; i++) {
      aTimes.push(new Date(base + i * DAY_MS));
      bTimes.push(new Date(base + i * DAY_MS + 5 * MIN_MS));
    }
    const result = analyzeSessionInterleave(buildSessions(aTimes), buildSessions(bTimes));
    expect(result.overlapMinutes).toBe(0);
    expect(result.qualifies).toBe(true);
  });
});

describe("jaccard / compareTargetSets", () => {
  it("computes overlap and returns 0 for an empty side", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 10);
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });

  it("qualifies only when BOTH the absolute count and the proportional floors are met", () => {
    const tight = compareTargetSets(new Set(["a", "b", "c", "d"]), new Set(["a", "b", "c", "e"]));
    expect(tight.shared).toEqual(["a", "b", "c"]);
    expect(tight.qualifies).toBe(true);

    // Three shared targets, but out of ~40 each — two prolific accounts
    // brushing past each other, not coordination.
    const wideA = new Set(Array.from({ length: 40 }, (_, i) => `a${i}`));
    const wideB = new Set(Array.from({ length: 40 }, (_, i) => `b${i}`));
    for (const id of ["x", "y", "z"]) {
      wideA.add(id);
      wideB.add(id);
    }
    const loose = compareTargetSets(wideA, wideB);
    expect(loose.shared).toHaveLength(3);
    expect(loose.qualifies).toBe(false);
  });

  it("does not qualify on a single shared target however proportionally large", () => {
    const result = compareTargetSets(new Set(["a"]), new Set(["a"]));
    expect(result.jaccard).toBe(1);
    expect(result.qualifies).toBe(false);
  });
});

describe("behavior signals under the registry", () => {
  it("uses a 30-minute session gap consistent with login_time_cluster", () => {
    expect(SESSION_GAP_MS).toBe(30 * 60 * 1000);
  });

  it("treats an hour of continuous activity as one session, not many", () => {
    const times: Date[] = [];
    const base = Date.UTC(2026, 5, 1, 18, 0, 0);
    for (let i = 0; i < 12; i++) times.push(new Date(base + i * 5 * MIN_MS));
    expect(buildSessions(times)).toHaveLength(1);
  });

  it("splits a multi-day timeline into one session per day", () => {
    const sessions = buildSessions(dailyAt(3, 5, 3));
    expect(sessions).toHaveLength(5);
    expect(sessions[1].start.getTime() - sessions[0].start.getTime()).toBe(DAY_MS);
  });

  it("keeps hour bucketing stable across a day boundary", () => {
    const rhythm = buildActivityRhythm([
      new Date("2026-06-01T23:30:00Z"),
      new Date("2026-06-02T00:30:00Z"),
    ]);
    expect(rhythm.hours[23]).toBe(1);
    expect(rhythm.hours[0]).toBe(1);
    expect(HOUR_MS).toBe(3600000);
  });
});
