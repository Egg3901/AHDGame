import { describe, it, expect } from "vitest";
import { getCycleAnchors, type CycleAnchorContext } from "./cycleAnchorContext";
import { pickNextCanonicalCycle } from "./canonicalCycle";
import { calendarTurn, turnToGameMonth } from "@/lib/utils/gameDate";

/**
 * End-to-end logic verification of the pre-iteration founding lifecycle, run
 * over the pure scheduling + calendar functions (no DB). Models a 1991-default
 * world through: founding spawn -> date pin -> completion offset -> re-stagger
 * handoff onto the historical calendar.
 */
describe("pre-iteration founding lifecycle (1991-default, end to end)", () => {
  const startingYear = 1991;
  const activeCtx: CycleAnchorContext = {
    startingYear,
    preset: "1991-default",
    preIterationActive: true,
  };

  /** Calendar year a race scheduled at `rawTurn` displays, given the offset. */
  const calYear = (rawTurn: number, offset: number) =>
    turnToGameMonth(calendarTurn(rawTurn, { preIterationTurns: offset }), startingYear).year;

  it("founding: every body spawns a cycle-0 race starting at turn 1", () => {
    const house = pickNextCanonicalCycle({
      electionType: "house",
      prevCycle: 0,
      currentTurn: 1,
      ctx: activeCtx,
    });
    expect(house?.cycle).toBe(0);
    expect(house?.startTurn).toBe(1);

    // All three Senate classes found TOGETHER (identical window, no stagger).
    const classes = ([1, 2, 3] as const).map((senateClass) =>
      pickNextCanonicalCycle({
        electionType: "senate",
        senateClass,
        prevCycle: 0,
        currentTurn: 1,
        ctx: activeCtx,
      })
    );
    expect(classes.every((c) => c?.cycle === 0)).toBe(true);
    expect(classes[0]).toEqual(classes[1]);
    expect(classes[1]).toEqual(classes[2]);
  });

  it("date is pinned to the era start for the whole founding phase", () => {
    // Raw turn advances 1..N while active, but the calendar stays at 1991.
    for (const rawTurn of [1, 50, 150, 289]) {
      expect(
        turnToGameMonth(calendarTurn(rawTurn, { preIterationActive: true }), startingYear)
      ).toEqual({ year: 1991, month: 0 });
    }
  });

  it("handoff: after completion, the calendar resumes at the era start and next cycles land on the historical years", () => {
    // Every founding race uses the same fixed 24h+24h window (endTurn 49), so
    // the phase completes ~turn 49 and detectPreIterationComplete stamps
    // offset = 49 - 1 = 48. (The historical mapping is offset-invariant, so the
    // exact founding length doesn't change which calendar years the next cycles
    // land on — only how long the pinned founding phase runs.)
    const offset = 48;

    // The calendar resumes at 1991 (turn 1) the moment the real game begins...
    expect(calYear(49, offset)).toBe(1991);
    // ...and advances normally thereafter.
    expect(calYear(49 + 48, offset)).toBe(1992);

    // Post-founding schedule (preIteration no longer active, offset applied):
    const doneCtx: CycleAnchorContext = {
      startingYear,
      preset: "1991-default",
      preIterationTurns: offset,
    };
    const anchors = getCycleAnchors(doneCtx);

    // House's first normal election lands on its historical 1992 midterm...
    expect(calYear(anchors.house, offset)).toBe(1992);
    // ...and the Senate stagger re-emerges on the real 1992 / 1994 / 1996 years.
    expect(calYear(anchors.senateClass3, offset)).toBe(1992);
    expect(calYear(anchors.senateClass1, offset)).toBe(1994);
    expect(calYear(anchors.senateClass2, offset)).toBe(1996);

    // And the spawner actually produces cycle 1 (not another founding) once the
    // phase is over, at the offset-shifted anchor.
    const nextHouse = pickNextCanonicalCycle({
      electionType: "house",
      prevCycle: 0,
      currentTurn: 49,
      ctx: doneCtx,
    });
    expect(nextHouse?.cycle).toBe(1);
    expect(nextHouse?.endTurn).toBe(anchors.house);
  });

  it("fairness: China's founding mandate is seated at the era start, not delayed to ~1994", () => {
    // The original bug: CN's first NPC completed ~1994 while others voted in year 1.
    // Under founding, CN's NPC is a cycle-0 race seated at the pinned era start.
    const cnNpc = pickNextCanonicalCycle({
      electionType: "npcDelegate",
      countryId: "CN",
      prevCycle: 0,
      currentTurn: 1,
      ctx: activeCtx,
    });
    expect(cnNpc?.cycle).toBe(0);
    expect(cnNpc?.startTurn).toBe(1);
    // Its NEXT (first normal) NPC still lands on the historical 1993 plenary.
    const offset = 48;
    const doneCtx: CycleAnchorContext = {
      startingYear,
      preset: "1991-default",
      preIterationTurns: offset,
    };
    expect(calYear(getCycleAnchors(doneCtx).cnNpcDelegate, offset)).toBe(1993);
  });
});
