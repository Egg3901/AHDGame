import { describe, expect, it } from "vitest";
import { isPresetAnchorDate, resolveResetStartDate } from "./resetStartDate";

describe("resolveResetStartDate", () => {
  it("keeps an authored anchor at turn one", () => {
    expect(resolveResetStartDate("1991-default", { year: 1991, week: 1 })).toEqual({
      year: 1991,
      week: 1,
      startingYear: 1991,
      currentTurn: 1,
      currentYear: 1991,
    });
  });

  it("converts an arbitrary year/week to the preset-relative turn", () => {
    expect(resolveResetStartDate("1991-default", { year: 1994, week: 17 })).toMatchObject({
      startingYear: 1991,
      currentYear: 1994,
      currentTurn: 161,
    });
  });

  it("rejects invalid dates and dates before the selected preset", () => {
    expect(() => resolveResetStartDate("2019-default", { year: 2007, week: 1 })).toThrow(
      /cannot precede/
    );
    expect(() => resolveResetStartDate("1953-default", { year: 1952, week: 1 })).toThrow(
      /Reset year/
    );
    expect(() => resolveResetStartDate("1953-default", { year: 1953, week: 49 })).toThrow(
      /Reset week/
    );
  });

  it("only treats week one of the authored start year as the anchor", () => {
    expect(isPresetAnchorDate("1979-default", { year: 1979, week: 1 })).toBe(true);
    expect(isPresetAnchorDate("1979-default", { year: 1979, week: 2 })).toBe(false);
  });
});
