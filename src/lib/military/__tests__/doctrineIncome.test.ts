import { describe, expect, it } from "vitest";
import { DOCTRINE_POINTS_PER_YEAR, doctrineIncomeDue } from "../doctrineIncome";

describe("doctrineIncomeDue", () => {
  it("grants nothing in the starting year", () => {
    expect(doctrineIncomeDue(1953, 1953)).toBe(0);
  });

  it("grants one year's points after the calendar ticks into the next year", () => {
    expect(doctrineIncomeDue(1953, 1954)).toBe(DOCTRINE_POINTS_PER_YEAR);
  });

  it("grants one point per elapsed game year from the world start", () => {
    expect(doctrineIncomeDue(1953, 1963)).toBe(10 * DOCTRINE_POINTS_PER_YEAR);
  });

  it("is idempotent once income has already been granted through the current year", () => {
    expect(doctrineIncomeDue(1953, 1954, 1954)).toBe(0);
  });

  it("grants only the years not yet booked when catching up", () => {
    expect(doctrineIncomeDue(1953, 1960, 1955)).toBe(5 * DOCTRINE_POINTS_PER_YEAR);
  });

  it("grants nothing when the calendar has not been resolved", () => {
    expect(doctrineIncomeDue(1953, Number.NaN)).toBe(0);
    expect(doctrineIncomeDue(Number.NaN, 1954)).toBe(0);
  });

  it("does not grant for a year before the world start", () => {
    expect(doctrineIncomeDue(1953, 1952)).toBe(0);
  });
});
