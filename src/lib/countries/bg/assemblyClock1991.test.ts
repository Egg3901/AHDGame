import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import type { Election } from "@/lib/db/types";
import { buildCanonicalSpawn } from "@/lib/turn/perpetualElections/engine";
import { buildBg1991AssemblySpawn } from "./assemblyClock1991";
import { BG_ORDINARY_ASSEMBLY_SEATS } from "./rules/assemblyTransition";
import {
  bgAssemblyCohortCanSpawn,
  bgFoundingMandateTermAnchor,
  bgOrdinarySeatingClockReady,
  bgGrandAssemblyRegularAnchor,
  planBg1991AssemblyClock,
} from "./rules/assemblyClock1991";

const now = new Date("2026-01-01T00:00:00Z");
const state = Object.keys(BG_ORDINARY_ASSEMBLY_SEATS)[0];
function previous(extras: Partial<Election> = {}): Election {
  return {
    _id: new ObjectId(),
    countryId: "BG",
    electionType: "nationalAssembly",
    state,
    cycle: 0,
    status: "resolved",
    totalSeats: 100,
    startTime: now,
    primaryEndTime: now,
    endTime: now,
    createdAt: now,
    updatedAt: new Date(now.getTime() - 3600000),
    ...extras,
  };
}
function input(extras: Partial<Parameters<typeof buildCanonicalSpawn>[0]> = {}) {
  return {
    countryId: "BG" as const,
    electionType: "nationalAssembly",
    state,
    currentTurn: 49,
    now,
    fallbackTotalSeats: 100,
    ctx: { preset: "1991-default", startingYear: 1991, preIterationTurns: 48 },
    openPrimaryImmediately: true,
    minPrimaryHours: 12,
    prev: previous(),
    ...extras,
  };
}

describe("Bulgarian decision-driven Assembly clock", () => {
  it("retains the June1994 Grand Assembly term until an enacted transition", () => {
    expect(bgGrandAssemblyRegularAnchor({ startingYear: 1991 })).toBe(168);
    const doc = buildBg1991AssemblySpawn(input(), { authorized: false });
    expect(doc).toMatchObject({
      cycle: 1,
      endTurn: 216,
      electionYear: 1994,
      totalSeats: 100,
      shiftedScheduleEndTurn: 216,
    });
  });
  it("opens the first ordinary campaign from the actual decision, including late alternate history", () => {
    const doc = buildBg1991AssemblySpawn(
      input({ currentTurn: 1730, fallbackTotalSeats: BG_ORDINARY_ASSEMBLY_SEATS[state] }),
      { authorized: true }
    );
    expect(doc).toMatchObject({
      cycle: 1,
      startTurn: 1730,
      primaryEndTurn: 1734,
      endTurn: 1736,
      electionYear: 2026,
      shiftedScheduleEndTurn: 1736,
      totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[state],
    });
  });
  it("anchors later ordinary elections to the first actual ballot plus four years", () => {
    const prev = previous({
      cycle: 1,
      totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[state],
      shiftedScheduleEndTurn: 80,
      endTurn: 80,
    });
    expect(
      buildBg1991AssemblySpawn(input({ prev, currentTurn: 81 }), { authorized: true })
    ).toMatchObject({ cycle: 2, startTurn: 81, primaryEndTurn: 270, endTurn: 272 });
    expect(
      buildBg1991AssemblySpawn(input({ prev, currentTurn: 500 }), { authorized: true })
    ).toMatchObject({ cycle: 2, primaryEndTurn: 504, endTurn: 506 });
  });
  it("preserves ordinary legacy calendars without a native shifted anchor", () => {
    const prev = previous({ cycle: 1, totalSeats: BG_ORDINARY_ASSEMBLY_SEATS[state] });
    expect(
      buildBg1991AssemblySpawn(input({ prev, currentTurn: 100 }), { authorized: true })?.endTurn
    ).toBe(278);
  });
  it.each(["active", "upcoming", "completed"] as const)(
    "blocks a preceding %s ballot",
    (status) => {
      expect(
        buildBg1991AssemblySpawn(input({ prev: previous({ status }) }), { authorized: true })
      ).toBeNull();
    }
  );
  it("does not duplicate a settled founding campaign while the global founding phase remains active", () => {
    expect(
      buildBg1991AssemblySpawn(
        input({ ctx: { preset: "1991-default", startingYear: 1991, preIterationActive: true } }),
        { authorized: true }
      )
    ).toBeNull();
    const founding = buildBg1991AssemblySpawn(
      input({
        prev: undefined,
        currentTurn: 1,
        ctx: { preset: "1991-default", startingYear: 1991, preIterationActive: true },
      }),
      { authorized: false }
    );
    expect(founding?.cycle).toBe(0);
  });
  it("blocks the whole next cohort while any latest-cycle region awaits national certification", () => {
    expect(
      bgAssemblyCohortCanSpawn([
        previous({ cycle: 2 }),
        previous({ cycle: 2, status: "completed" }),
      ])
    ).toBe(false);
    expect(
      bgAssemblyCohortCanSpawn([
        previous({ cycle: 1, status: "completed" }),
        previous({ cycle: 2 }),
      ])
    ).toBe(true);
  });
  it.each(["1953-default", "1979-default", "2027-default"])(
    "keeps the existing %s scheduler",
    (preset) => {
      const params = input({ ctx: { preset, startingYear: Number(preset.slice(0, 4)) } });
      expect(buildBg1991AssemblySpawn(params, { authorized: false })).toEqual(
        buildCanonicalSpawn(params)
      );
    }
  );

  it("bounds a founding count completed after the original mandate expired", () => {
    expect(bgFoundingMandateTermAnchor(216, 48)).toBe(216);
    expect(bgFoundingMandateTermAnchor(216, 220)).toBe(412);
    expect(() => bgFoundingMandateTermAnchor(216, NaN)).toThrow();
  });
  it("requires actual consent for an early handover and never seats during founding", () => {
    expect(bgOrdinarySeatingClockReady({ currentTurn: 40, calendarTurn: 40 })).toBe(false);
    expect(
      bgOrdinarySeatingClockReady({ currentTurn: 40, calendarTurn: 40, authorizedTurn: 25 })
    ).toBe(true);
    expect(
      bgOrdinarySeatingClockReady({ currentTurn: 40, calendarTurn: 40, authorizedTurn: 41 })
    ).toBe(false);
    expect(
      bgOrdinarySeatingClockReady({
        currentTurn: 40,
        calendarTurn: 40,
        authorizedTurn: 25,
        preIterationActive: true,
      })
    ).toBe(false);
  });
  it("rejects corrupt native clock inputs", () => {
    expect(() =>
      bgGrandAssemblyRegularAnchor({ startingYear: 1991, nativeAnchorTurn: NaN })
    ).toThrow();
    expect(() =>
      planBg1991AssemblyClock({ currentTurn: -1, authorized: true, previousOrdinary: false })
    ).toThrow();
    expect(() =>
      planBg1991AssemblyClock({
        currentTurn: 100,
        authorized: true,
        previousOrdinary: true,
        previous: previous({ shiftedScheduleEndTurn: 1.5 }),
      })
    ).toThrow();
  });
});
