import { describe, it, expect } from "vitest";
import { verdictOf, openingLine, momentumOf } from "./recordCopy";

const base = {
  control: 80,
  controlStart: 50,
  sideALabel: "NATO",
  sideBLabel: "Warsaw Pact",
  hostCountry: "DE",
  engagements: 2,
  unopposedAdvances: 3,
  casualties: 26146,
  startYear: 1961,
};

describe("verdictOf", () => {
  it("names whoever is ahead, never a fixed side", () => {
    expect(verdictOf(base).headline).toMatch(/^Warsaw Pact/);
    expect(verdictOf({ ...base, control: 20 }).headline).toMatch(/^NATO/);
  });

  it("scales the claim to the size of the lead", () => {
    expect(verdictOf({ ...base, control: 50 }).headline).toBe("DE is split down the middle.");
    expect(verdictOf({ ...base, control: 58 }).headline).toBe("Warsaw Pact is ahead in DE.");
    expect(verdictOf({ ...base, control: 65 }).headline).toBe("Warsaw Pact is well ahead in DE.");
    expect(verdictOf({ ...base, control: 80 }).headline).toBe(
      "Warsaw Pact holds three quarters of DE."
    );
    expect(verdictOf({ ...base, control: 95 }).headline).toBe("Warsaw Pact has all but taken DE.");
  });

  // A dead-even front must not read as a lead for whoever rounds up.
  it("calls a 50/50 front split from either direction", () => {
    expect(verdictOf({ ...base, control: 52 }).headline).toBe("DE is split down the middle.");
    expect(verdictOf({ ...base, control: 48 }).headline).toBe("DE is split down the middle.");
  });

  it("states movement from the LEADER's side, so it agrees with the headline", () => {
    // The Pact leads and has gained: movement runs toward it.
    expect(verdictOf(base).detail).toMatch(/moved 30 points toward Warsaw Pact since 1961/);
    // NATO leads, having taken ground from a 50/50 opening.
    expect(verdictOf({ ...base, control: 20 }).detail).toMatch(
      /moved 30 points away from Warsaw Pact since 1961/
    );
  });

  it("says the line has not moved when it has not", () => {
    expect(verdictOf({ ...base, control: 50, controlStart: 50 }).detail).toMatch(
      /has not moved from where it opened in 1961/
    );
  });

  it("says a leader has given back ground", () => {
    // The Pact still leads at 60 but opened at 70 — it has lost 10 points.
    expect(verdictOf({ ...base, control: 60, controlStart: 70 }).detail).toMatch(
      /Warsaw Pact has given back 10 points since 1961/
    );
  });

  it("counts the cost when there has been fighting", () => {
    expect(verdictOf(base).detail).toMatch(/2 engagements, 26,146 dead/);
    expect(verdictOf({ ...base, engagements: 1, casualties: 40 }).detail).toMatch(
      /1 engagement, 40 dead/
    );
  });

  // An uncontested front is a different thing from a quiet one, and the page
  // must not report "0 engagements" as if a battle had ended in nothing.
  it("says an uncontested advance is uncontested", () => {
    expect(verdictOf({ ...base, engagements: 0, casualties: 0 }).detail).toMatch(
      /3 offensives, none of them contested/
    );
  });

  it("says so when no shot has been fired", () => {
    expect(
      verdictOf({ ...base, engagements: 0, unopposedAdvances: 0, casualties: 0 }).detail
    ).toMatch(/No shot has been fired/);
  });
});

describe("openingLine", () => {
  const o = {
    controlStart: 50,
    sideALabel: "NATO",
    sideBLabel: "Warsaw Pact",
    hostCountry: "DE",
    hostIsBelligerent: false,
    startYear: 1961,
  };

  it("states where the line opened, and when", () => {
    expect(openingLine(o)).toMatch(/^opened at 50 \/ 50 in 1961/);
    expect(openingLine({ ...o, controlStart: 30 })).toMatch(/^opened at 70 \/ 30 in 1961/);
  });

  // A proxy war fought across a country on neither side is the normal case, and
  // the split means nothing until a reader knows the host is not a belligerent.
  it("says when the host fights on neither side", () => {
    expect(openingLine(o)).toMatch(/DE fights on neither side/);
    expect(openingLine({ ...o, hostIsBelligerent: true })).not.toMatch(/neither side/);
  });
});

describe("momentumOf", () => {
  const m = {
    sideALabel: "NATO",
    sideBLabel: "Warsaw Pact",
    recentGainA: 0,
    engagements: 2,
    unopposedAdvances: 3,
    casualties: 26146,
    contested: true,
  };

  it("names the side that is actually gaining", () => {
    expect(momentumOf({ ...m, recentGainA: 6 })).toMatchObject({
      tag: "NATO ADVANCING",
      tagColor: "a",
    });
    expect(momentumOf({ ...m, recentGainA: -6 })).toMatchObject({
      tag: "WARSAW PACT ADVANCING",
      tagColor: "b",
    });
  });

  it("calls a static line static rather than picking a winner", () => {
    expect(momentumOf(m)).toMatchObject({ tag: "THE LINE HOLDS", tagColor: "neutral" });
    expect(momentumOf({ ...m, recentGainA: 0.2 }).tag).toBe("THE LINE HOLDS");
  });

  it("distinguishes a stalemate paid for in blood from an empty front", () => {
    expect(momentumOf(m).note).toMatch(/2 engagements and 26,146 dead have moved the line nowhere/);
    expect(momentumOf({ ...m, contested: false }).note).toMatch(
      /3 offensives and no engagement — nothing has stood against this front/
    );
  });

  it("reports the ground a contested advance actually bought", () => {
    expect(momentumOf({ ...m, recentGainA: -6 }).note).toMatch(
      /2 engagements, 26,146 dead, and 6 points of ground/
    );
  });
});
