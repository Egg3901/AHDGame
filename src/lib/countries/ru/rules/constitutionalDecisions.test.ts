import { describe, expect, it } from "vitest";
import {
  russianConstitutionalDecisionAvailability as availability,
  passesRussianConstitutionalDecision as passes,
} from "./constitutionalDecisions";
const base = {
  preset: "1991-default",
  currentTurn: 160,
  calendarTurn: 160,
  country: { ruSovietSuccessionSinceTurn: 48 },
};
describe("independent Russian constitutional decisions", () => {
  it("opens only the presidency in April 1991 after a ratified early succession", () => {
    const early = {
      ...base,
      currentTurn: 13,
      calendarTurn: 13,
      country: { ruSovietSuccessionSinceTurn: 12 },
    };
    expect(availability({ ...early, kind: "presidency" })).toEqual({
      available: true,
      reason: "available",
    });
    expect(availability({ ...early, kind: "federalAssembly" }).reason).toBe("before-date");
    expect(
      availability({ ...early, currentTurn: 12, calendarTurn: 12, kind: "presidency" }).reason
    ).toBe("before-date");
  });
  it("opens the replacement Assembly in September 1993 without requiring a presidency", () => {
    expect(
      availability({ ...base, currentTurn: 129, calendarTurn: 129, kind: "federalAssembly" })
        .available
    ).toBe(true);
    expect(
      availability({ ...base, currentTurn: 128, calendarTurn: 128, kind: "federalAssembly" }).reason
    ).toBe("before-date");
  });
  it("leaves the other decision open after one mandate is authorized", () => {
    const presidency = { ...base.country, ruPresidencyMandateSinceTurn: 150 };
    const assembly = { ...base.country, ruFederalAssemblyMandateSinceTurn: 150 };
    expect(availability({ ...base, country: presidency, kind: "presidency" }).reason).toBe(
      "already-authorized"
    );
    expect(availability({ ...base, country: presidency, kind: "federalAssembly" }).available).toBe(
      true
    );
    expect(availability({ ...base, country: assembly, kind: "presidency" }).available).toBe(true);
  });
  it("waits for the founding calendar, sovereign succession and an active legislature", () => {
    expect(availability({ ...base, calendarTurn: 1, kind: "presidency" }).reason).toBe(
      "before-date"
    );
    expect(availability({ ...base, country: null, kind: "presidency" }).reason).toBe(
      "awaiting-succession"
    );
    expect(
      availability({ ...base, country: { ruSovietSuccessionSinceTurn: 161 }, kind: "presidency" })
        .reason
    ).toBe("awaiting-succession");
    expect(
      availability({
        ...base,
        country: { ...base.country, ruCongressDissolvedSinceTurn: 129 },
        kind: "federalAssembly",
      }).reason
    ).toBe("no-legislature");
    expect(availability({ ...base, preset: "1953-default", kind: "presidency" }).reason).toBe(
      "other-era"
    );
  });
});

describe("Russian constitutional full-capacity threshold", () => {
  it("counts vacancies and abstentions against reaching two-thirds", () => {
    expect(passes(3, 10)).toBe(false);
    expect(passes(6, 10)).toBe(false);
    expect(passes(7, 10)).toBe(true);
    expect(passes(4, 6)).toBe(true);
    expect(passes(769, 1154)).toBe(false);
    expect(passes(770, 1154)).toBe(true);
  });
  it.each([
    [1, 0],
    [1, -1],
    [2, 1],
    [1.5, 2],
    [NaN, 3],
    [1, Infinity],
  ])("rejects invalid totals %s / %s", (votes, seats) => {
    expect(passes(votes, seats)).toBe(false);
  });
});
