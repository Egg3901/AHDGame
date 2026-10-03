import { describe, expect, it } from "vitest";
import {
  resolveRussianDumaList as list,
  resolveRussianDumaConstituency as district,
} from "./assemblyResult";
import {
  russianDuma1995DecisionAvailability as availability,
  russianDumaElectoralLaw,
} from "./dumaElectoralLaw";

const ballot = {
  registeredVoters: 1000,
  againstAllVotes: 0,
  invalidBallots: 100,
  options: [
    { id: "large", votes: 855, registrationOrder: 0 },
    { id: "small", votes: 45, registrationOrder: 1 },
  ],
};
describe("Original1995 Duma electoral law", () => {
  it("preserves legacy1993 admission while invalid ballots change the enacted1995 threshold", () => {
    expect(list(ballot)).toMatchObject({ partySeats: { large: 214, small: 11 } });
    expect(list({ ...ballot, law: "law1995" })).toMatchObject({
      partySeats: { large: 225, small: 0 },
    });
  });
  it("includes invalid list ballots in turnout and admits exactly five percent of all cast ballots", () => {
    const input = {
      registeredVoters: 1000,
      againstAllVotes: 0,
      invalidBallots: 200,
      options: [{ id: "exact", votes: 50, registrationOrder: 0 }],
    };
    expect(list(input)).toMatchObject({ outcome: "repeat" });
    expect(list({ ...input, law: "law1995" })).toMatchObject({
      outcome: "elected",
      validBallots: 50,
      partySeats: { exact: 225 },
    });
    expect(list({ ...input, registeredVoters: 1001, law: "law1995" })).toMatchObject({
      outcome: "repeat",
    });
  });
  it("uses signed ballot issuance for district turnout without inflating valid candidate votes", () => {
    const input = {
      registeredVoters: 1000,
      againstAllVotes: 10,
      invalidBallots: 20,
      issuedBallots: 250,
      options: [{ id: "winner", votes: 5, registrationOrder: 0 }],
    };
    expect(district(input)).toMatchObject({ outcome: "repeat" });
    expect(district({ ...input, law: "law1995" })).toEqual({
      outcome: "elected",
      validBallots: 15,
      winnerId: "winner",
    });
    expect(district({ ...input, issuedBallots: 249, law: "law1995" })).toMatchObject({
      outcome: "repeat",
    });
  });
  it("does not apply later ranked-list admission or an unsupported original1995 against-all veto", () => {
    expect(
      list({
        registeredVoters: 100,
        againstAllVotes: 95,
        law: "law1995",
        options: [{ id: "only", votes: 5, registrationOrder: 0 }],
      })
    ).toMatchObject({ partySeats: { only: 225 } });
    expect(
      district({
        registeredVoters: 100,
        againstAllVotes: 24,
        law: "law1995",
        options: [{ id: "only", votes: 1, registrationOrder: 0 }],
      })
    ).toMatchObject({ winnerId: "only" });
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "refuses malformed invalid counts%s",
    (invalidBallots) => {
      expect(() => list({ ...ballot, invalidBallots, law: "law1995" })).toThrow();
    }
  );
  it("refuses cast ballots exceeding the register or issued count", () => {
    expect(() => list({ ...ballot, invalidBallots: 101 })).toThrow("register");
    expect(() => district({ ...ballot, issuedBallots: 999 })).toThrow("register");
    expect(() => district({ ...ballot, issuedBallots: 1001 })).toThrow("register");
  });
  it("defaults old saved ballots to the original decree", () => {
    expect(russianDumaElectoralLaw()).toBe("decree1993");
  });
  const clock = { preset: "1991-default", turn: 213, calendarTurn: 213, assemblySinceTurn: 150 };
  it("opens a decision in June1995 without itself authorizing any law", () => {
    expect(availability(clock)).toEqual({ available: true, reason: "available" });
    expect(availability({ ...clock, calendarTurn: 212 })).toMatchObject({ reason: "before-date" });
    expect(availability({ ...clock, enacted: true })).toMatchObject({
      reason: "already-authorized",
    });
  });
  it.each([undefined, 0, 214])(
    "requires a real already seated Federal Assembly%s",
    (assemblySinceTurn) => {
      expect(availability({ ...clock, assemblySinceTurn })).toMatchObject({
        reason: "no-legislature",
      });
    }
  );
  it("refuses dissolved states, other eras and invalid clocks", () => {
    expect(availability({ ...clock, dissolved: true })).toMatchObject({ reason: "no-legislature" });
    expect(availability({ ...clock, preset: "1953-default" })).toMatchObject({
      reason: "other-era",
    });
    expect(() => availability({ ...clock, turn: 0 })).toThrow("turns");
  });
});
