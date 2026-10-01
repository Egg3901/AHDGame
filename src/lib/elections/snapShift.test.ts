import { describe, it, expect } from "vitest";
import type { Election } from "@/lib/db/types";
import { cycleAnchorContextFromGameState } from "./cycleAnchorContext";
import { planNextLowerChamberCycle, shiftedAnchorTurn, snapAnchorEndTime } from "./snapShift";

const at = (ms: number) => new Date(ms);

type PriorElection = Pick<Election, "electionType" | "endTime" | "imposedSnap">;

function prev(over: Partial<PriorElection> = {}): PriorElection {
  return { electionType: "snap_commons", endTime: at(1000), ...over };
}

describe("snapAnchorEndTime", () => {
  it("returns the end time of a prime minister's snap, which drags the calendar", () => {
    // Shipped behaviour: the immediate post-snap regular anchors to the snap's
    // end turn. This test exists so the imposed-snap change cannot silently
    // alter it.
    expect(snapAnchorEndTime(prev(), "snap_commons")).toEqual(at(1000));
  });

  it("returns null for an imposed snap, so the calendar stays canonical", () => {
    // A settlement dissolves a chamber. It does not also reschedule every
    // future election in the country.
    expect(snapAnchorEndTime(prev({ imposedSnap: true }), "snap_commons")).toBeNull();
  });

  it("treats imposedSnap false the same as a prime minister's snap", () => {
    expect(snapAnchorEndTime(prev({ imposedSnap: false }), "snap_commons")).toEqual(at(1000));
  });

  it("returns null for a regular election, so admin edits cannot drag the calendar", () => {
    // The existing rule this helper preserves: only a SNAP anchors the next
    // regular. An admin-accelerated regular must not.
    expect(snapAnchorEndTime(prev({ electionType: "commons" }), "snap_commons")).toBeNull();
  });

  it("returns null when the snap type does not match the caller's chamber", () => {
    expect(snapAnchorEndTime(prev({ electionType: "snap_shugiin" }), "snap_commons")).toBeNull();
  });

  it("returns null when there is no prior election at all", () => {
    expect(snapAnchorEndTime(null, "snap_commons")).toBeNull();
    expect(snapAnchorEndTime(undefined, "snap_commons")).toBeNull();
  });

  it("returns null when the prior snap carries no end time", () => {
    expect(snapAnchorEndTime(prev({ endTime: undefined }), "snap_commons")).toBeNull();
  });
});

// Live UK calendar at the time of the 1977 snap: 1953 start, 48-turn founding
// offset, snap resolved at turn 1228, canonical Commons cycle 6 was 1980.
const ctx1953 = cycleAnchorContextFromGameState({
  startingYear: 1953,
  preset: "1953-default",
  preIterationTurns: 48,
} as never);
const MS = 3_600_000;
const NOW = new Date("2026-10-01T00:00:00Z");

function planFor(
  prior: Parameters<typeof planNextLowerChamberCycle>[0]["prev"],
  currentTurn: number
) {
  return planNextLowerChamberCycle({
    electionType: "commons",
    snapType: "snap_commons",
    prev: prior,
    currentTurn,
    ctx: ctx1953,
    endTimeToTurn: (endTime) => currentTurn - Math.round((NOW.getTime() - endTime.getTime()) / MS),
  });
}

describe("shiftedAnchorTurn", () => {
  const toTurn = () => 1228;

  it("anchors a called snap to its end turn", () => {
    expect(shiftedAnchorTurn(prev(), "commons", "snap_commons", toTurn)).toBe(1228);
  });

  it("anchors a regular on a shifted schedule to its scheduled end turn, not its end time", () => {
    // An admin could have accelerated this race's real end time; the stamp is
    // what keeps the calendar.
    expect(
      shiftedAnchorTurn(
        { electionType: "commons", endTime: at(5), shiftedScheduleEndTurn: 1468 },
        "commons",
        "snap_commons",
        toTurn
      )
    ).toBe(1468);
  });

  it("leaves canonical regulars and imposed snaps on the canonical calendar", () => {
    expect(
      shiftedAnchorTurn(
        { electionType: "commons", endTime: at(5) },
        "commons",
        "snap_commons",
        toTurn
      )
    ).toBeNull();
    expect(
      shiftedAnchorTurn(prev({ imposedSnap: true }), "commons", "snap_commons", toTurn)
    ).toBeNull();
  });

  it("ignores a stamp from another chamber", () => {
    expect(
      shiftedAnchorTurn(
        { electionType: "shugiin", endTime: at(5), shiftedScheduleEndTurn: 1468 },
        "commons",
        "snap_commons",
        toTurn
      )
    ).toBeNull();
  });
});

describe("planNextLowerChamberCycle", () => {
  it("schedules the post-snap Parliament one full term after the snap and stamps it", () => {
    const plan = planFor(
      { electionType: "snap_commons", cycle: 6, endTime: new Date(NOW.getTime() - MS) },
      1229
    );
    expect(plan?.spawn.cycle).toBe(7);
    expect(plan?.spawn.endTurn).toBe(1468);
    expect(plan?.electionYear).toBe(1982);
    expect(plan?.shiftedScheduleEndTurn).toBe(1468);
  });

  it("keeps the reset term clock for the Parliament after that, instead of snapping back to the canonical cycle", () => {
    // Before the fix the 1982 regular was followed by the canonical cycle 8
    // (1990): an eight-year Parliament.
    const plan = planFor(
      {
        electionType: "commons",
        cycle: 7,
        endTime: new Date(NOW.getTime() - MS),
        shiftedScheduleEndTurn: 1468,
      },
      1469
    );
    expect(plan?.spawn.cycle).toBe(8);
    expect(plan?.spawn.endTurn).toBe(1708);
    expect(plan?.electionYear).toBe(1987);
    expect(plan?.shiftedScheduleEndTurn).toBe(1708);
  });

  it("leaves an unshifted regular on the canonical calendar with no stamp", () => {
    const plan = planFor(
      { electionType: "commons", cycle: 5, endTime: new Date(NOW.getTime() - MS) },
      1132
    );
    expect(plan?.spawn.cycle).toBe(6);
    expect(plan?.electionYear).toBe(1980);
    expect(plan?.shiftedScheduleEndTurn).toBeUndefined();
  });

  it("returns an imposed snap's successor to the canonical calendar", () => {
    const plan = planFor(
      {
        electionType: "snap_commons",
        cycle: 6,
        imposedSnap: true,
        endTime: new Date(NOW.getTime() - MS),
      },
      1229
    );
    expect(plan?.spawn.cycle).toBe(7);
    expect(plan?.electionYear).toBe(1985);
    expect(plan?.shiftedScheduleEndTurn).toBeUndefined();
  });

  it("falls back to the canonical calendar when the shifted deadline has already passed", () => {
    // A long pause can leave no room for a primary before the shifted date.
    // Spawning nothing forever would be worse than rejoining the canonical cycle.
    const plan = planFor(
      {
        electionType: "commons",
        cycle: 7,
        endTime: new Date(NOW.getTime() - MS),
        shiftedScheduleEndTurn: 1468,
      },
      1700
    );
    expect(plan).not.toBeNull();
    expect(plan?.shiftedScheduleEndTurn).toBeUndefined();
    expect(plan?.spawn.endTurn).toBeGreaterThan(1700);
  });
});
