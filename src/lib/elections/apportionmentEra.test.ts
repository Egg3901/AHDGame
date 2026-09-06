/**
 * Era gates on the electoral college.
 *
 * These three constitutional/statutory facts were applied unconditionally, so
 * every historical world ran modern rules. The existing golden test only
 * exercises the 2019 preset, which is why none of them ever failed.
 */
import { describe, expect, it } from "vitest";
import {
  buildApportionment,
  electoralVoteUnitsFromSeats,
  electoralVotesFromSeats,
} from "./apportionment";
import { ELECTORAL_VOTES_1953, getHouseSeats } from "@/lib/constants/states";

const seats1953 = () => getHouseSeats("1953-default");
const seats2019 = () => getHouseSeats("2019-default");

describe("DC and the 23rd Amendment", () => {
  it("gives DC no electoral votes in 1953", () => {
    const ev = electoralVotesFromSeats(seats1953(), { preset: "1953-default" });
    expect(ev.DC).toBeUndefined();
  });

  it("agrees with the authored 1953 seed constant, which has no DC either", () => {
    // The builder used to contradict this constant — that was the bug.
    const ev = electoralVotesFromSeats(seats1953(), { preset: "1953-default" });
    expect("DC" in ELECTORAL_VOTES_1953).toBe(false);
    expect("DC" in ev).toBe(false);
  });

  it("gives DC 3 once a 1953 world's clock passes 1961, when the caller passes the live year", () => {
    // Every presidential caller used to pass only the preset, so the gate
    // resolved against 1953 forever and the 1964 college ran 530 instead of 538.
    const ev = electoralVotesFromSeats(seats1953(), { preset: "1953-default", year: 1965 });
    expect(ev.DC).toBe(3);
    const evAt1958 = electoralVotesFromSeats(seats1953(), { preset: "1953-default", year: 1958 });
    expect(evAt1958.DC).toBeUndefined();
  });

  it("still gives DC 3 in the modern era", () => {
    expect(electoralVotesFromSeats(seats2019(), { preset: "2019-default" }).DC).toBe(3);
  });

  it("turns DC's votes on when a 1953 world reaches 1961, and not before", () => {
    const seats = seats1953();
    expect(
      electoralVotesFromSeats(seats, { preset: "1953-default", year: 1960 }).DC
    ).toBeUndefined();
    expect(electoralVotesFromSeats(seats, { preset: "1953-default", year: 1961 }).DC).toBe(3);
    expect(electoralVotesFromSeats(seats, { preset: "1953-default", year: 1964 }).DC).toBe(3);
  });
});

describe("Maine and Nebraska district splits", () => {
  const unitIds = (year: number | undefined, preset: string) =>
    electoralVoteUnitsFromSeats(getHouseSeats(preset), { preset, year }).map((u) => u.unitId);

  it("keeps Maine winner-take-all in 1953 — it did not split until 1972", () => {
    const ids = unitIds(undefined, "1953-default");
    expect(ids.filter((id) => id.startsWith("ME_CD"))).toEqual([]);
    expect(ids).toContain("ME");
  });

  it("keeps Nebraska winner-take-all in 1979 — it did not split until 1992", () => {
    const ids = unitIds(undefined, "1979-default");
    expect(ids.filter((id) => id.startsWith("NE_CD"))).toEqual([]);
  });

  it("splits Maine but not Nebraska in a world sitting between 1972 and 1992", () => {
    const ids = unitIds(1980, "1979-default");
    expect(ids.filter((id) => id.startsWith("ME_CD")).length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.startsWith("NE_CD"))).toEqual([]);
  });

  it("splits both in the modern era", () => {
    const ids = unitIds(undefined, "2019-default");
    expect(ids.filter((id) => id.startsWith("ME_CD")).length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.startsWith("NE_CD")).length).toBeGreaterThan(0);
  });

  it("conserves each state's total electoral votes whether or not it splits", () => {
    for (const [preset, year] of [
      ["1953-default", undefined],
      ["1979-default", undefined],
      ["2019-default", undefined],
      ["1953-default", 1975],
    ] as const) {
      const seats = getHouseSeats(preset);
      const ev = electoralVotesFromSeats(seats, { preset, year });
      const units = electoralVoteUnitsFromSeats(seats, { preset, year });
      for (const stateId of ["ME", "NE"]) {
        if (ev[stateId] === undefined) continue;
        const total = units.filter((u) => u.stateId === stateId).reduce((sum, u) => sum + u.ev, 0);
        expect(total, `${stateId} @ ${preset}/${year}`).toBe(ev[stateId]);
      }
    }
  });
});

describe("the national electoral college totals stay coherent", () => {
  it("sums to 531 in 1953 (48 states, no DC) and 538 today", () => {
    const ev1953 = electoralVotesFromSeats(seats1953(), { preset: "1953-default" });
    const total1953 = Object.values(ev1953).reduce((a, b) => a + b, 0);
    // 435 House seats + 96 senators across 48 states, and no DC.
    expect(total1953).toBe(531);

    const ev2019 = electoralVotesFromSeats(seats2019(), { preset: "2019-default" });
    expect(Object.values(ev2019).reduce((a, b) => a + b, 0)).toBe(538);
  });

  it("adds exactly three votes when the 23rd Amendment lands", () => {
    const seats = seats1953();
    const before = Object.values(
      electoralVotesFromSeats(seats, { preset: "1953-default", year: 1960 })
    ).reduce((a, b) => a + b, 0);
    const after = Object.values(
      electoralVotesFromSeats(seats, { preset: "1953-default", year: 1961 })
    ).reduce((a, b) => a + b, 0);
    expect(after - before).toBe(3);
  });
});

describe("buildApportionment threads the era through", () => {
  it("keeps the 1953 world free of DC and of district splits", () => {
    const a = buildApportionment({}, "1953-default");
    expect(a.electoralVotes.DC).toBeUndefined();
    expect(a.electoralVoteUnits.filter((u) => u.unitId.includes("_CD"))).toEqual([]);
  });

  it("respects an explicit live year over the preset's starting year", () => {
    const a = buildApportionment({}, "1953-default", 1995);
    expect(a.electoralVotes.DC).toBe(3);
    expect(a.electoralVoteUnits.filter((u) => u.unitId.startsWith("ME_CD")).length).toBeGreaterThan(
      0
    );
    expect(a.electoralVoteUnits.filter((u) => u.unitId.startsWith("NE_CD")).length).toBeGreaterThan(
      0
    );
  });
});
