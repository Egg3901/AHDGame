import { describe, it, expect } from "vitest";
import {
  validatePeaceTerm,
  DEMILITARISATION_DEFAULT_TURNS,
  DEMILITARISATION_MAX_TURNS,
  type PeaceTerm,
  type PeaceTermContext,
} from "./peaceTerm";

const ctx: PeaceTermContext = {
  from: "UK",
  to: "TR",
  target: "TR",
  targetSystem: "presidential",
  maxIndemnity: 1000,
};

describe("validatePeaceTerm: indemnity", () => {
  it("accepts an amount inside the ceiling", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 500 };
    expect(validatePeaceTerm(term, ctx)).toEqual({ ok: true });
  });

  it("accepts a zero amount, which is a white peace", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 0 };
    expect(validatePeaceTerm(term, ctx)).toEqual({ ok: true });
  });

  it("accepts an amount exactly at the ceiling", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 1000 };
    expect(validatePeaceTerm(term, ctx)).toEqual({ ok: true });
  });

  it("refuses a negative amount", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: -1 };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("refuses NaN, which slips past a bare comparison", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: Number.NaN };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("refuses an amount over the payer's ceiling", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 1001 };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("refuses a payer who is not a party to the deal", () => {
    const term: PeaceTerm = { kind: "indemnity", payer: "FR", amount: 10 };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("accepts either party as the payer, so a winner can pay to disengage", () => {
    expect(validatePeaceTerm({ kind: "indemnity", payer: "UK", amount: 10 }, ctx).ok).toBe(true);
    expect(validatePeaceTerm({ kind: "indemnity", payer: "TR", amount: 10 }, ctx).ok).toBe(true);
  });

  it("skips the ceiling when the payer has no GDP on record", () => {
    // maxIndemnityForGdp returns null for a missing GDP, and the existing
    // validator treats null as "no ceiling passed" rather than a zero ceiling.
    const term: PeaceTerm = { kind: "indemnity", payer: "TR", amount: 9e9 };
    expect(validatePeaceTerm(term, { ...ctx, maxIndemnity: null })).toEqual({ ok: true });
  });
});

describe("validatePeaceTerm: regime change", () => {
  it("accepts a system the target does not already have", () => {
    const term: PeaceTerm = { kind: "regime_change", targetSystem: "onePartyState" };
    expect(validatePeaceTerm(term, ctx)).toEqual({ ok: true });
  });

  it("refuses a term that changes nothing", () => {
    const term: PeaceTerm = { kind: "regime_change", targetSystem: "presidential" };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("refuses installing a crown that does not exist", () => {
    // A war can topple a government. It cannot invent a monarchy: there is no
    // dynasty to seat, and imperialCharacters is not something a treaty writes.
    const term: PeaceTerm = { kind: "regime_change", targetSystem: "parliamentaryMonarchy" };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("refuses a monarchy keeping its own system, without crashing", () => {
    const term: PeaceTerm = { kind: "regime_change", targetSystem: "parliamentaryMonarchy" };
    const monarchy: PeaceTermContext = { ...ctx, targetSystem: "parliamentaryMonarchy" };
    expect(validatePeaceTerm(term, monarchy).ok).toBe(false);
  });

  it("lets a monarchy be converted to a republic, keeping its crown question separate", () => {
    // The crown surviving is acceptPeace's business, not the validator's. What
    // matters here is that a monarchy is a legal TARGET of a conversion.
    const term: PeaceTerm = { kind: "regime_change", targetSystem: "parliamentaryRepublic" };
    const monarchy: PeaceTermContext = { ...ctx, targetSystem: "parliamentaryMonarchy" };
    expect(validatePeaceTerm(term, monarchy)).toEqual({ ok: true });
  });

  it("accepts a named ruling party that exists in the target", () => {
    const term: PeaceTerm = {
      kind: "regime_change",
      targetSystem: "onePartyState",
      rulingPartyId: 2,
    };
    expect(validatePeaceTerm(term, { ...ctx, targetPartyIds: [1, 2, 3] })).toEqual({ ok: true });
  });

  it("refuses a named ruling party the target does not have", () => {
    const term: PeaceTerm = {
      kind: "regime_change",
      targetSystem: "onePartyState",
      rulingPartyId: 9,
    };
    expect(validatePeaceTerm(term, { ...ctx, targetPartyIds: [1, 2, 3] }).ok).toBe(false);
  });

  it("skips the party check when no list was loaded", () => {
    // Null means "not passed", matching maxIndemnity's stance: the check is
    // skipped rather than failed, and installOnePartyState ignores an id that
    // names no party of the country.
    const term: PeaceTerm = {
      kind: "regime_change",
      targetSystem: "onePartyState",
      rulingPartyId: 9,
    };
    expect(validatePeaceTerm(term, { ...ctx, targetPartyIds: null })).toEqual({ ok: true });
  });

  it("refuses naming a ruling party for a system that has none", () => {
    // A republic forms a government from its chamber. Naming a party alongside
    // one is a contradiction the offerer plainly did not mean.
    const term: PeaceTerm = {
      kind: "regime_change",
      targetSystem: "parliamentaryRepublic",
      rulingPartyId: 2,
    };
    expect(validatePeaceTerm(term, { ...ctx, targetPartyIds: [1, 2] }).ok).toBe(false);
  });

  it("refuses a party id that is not a positive integer", () => {
    const term: PeaceTerm = {
      kind: "regime_change",
      targetSystem: "onePartyState",
      rulingPartyId: 0,
    };
    expect(validatePeaceTerm(term, { ...ctx, targetPartyIds: [0, 1] }).ok).toBe(false);
  });
});

describe("validatePeaceTerm: demilitarisation", () => {
  it("accepts the default duration", () => {
    const term: PeaceTerm = { kind: "demilitarisation", turns: DEMILITARISATION_DEFAULT_TURNS };
    expect(validatePeaceTerm(term, ctx)).toEqual({ ok: true });
  });

  it("accepts a duration exactly at the ceiling", () => {
    const term: PeaceTerm = { kind: "demilitarisation", turns: DEMILITARISATION_MAX_TURNS };
    expect(validatePeaceTerm(term, ctx)).toEqual({ ok: true });
  });

  it("refuses a zero or negative duration", () => {
    expect(validatePeaceTerm({ kind: "demilitarisation", turns: 0 }, ctx).ok).toBe(false);
    expect(validatePeaceTerm({ kind: "demilitarisation", turns: -5 }, ctx).ok).toBe(false);
  });

  it("refuses a duration over the ceiling", () => {
    const term: PeaceTerm = { kind: "demilitarisation", turns: DEMILITARISATION_MAX_TURNS + 1 };
    expect(validatePeaceTerm(term, ctx).ok).toBe(false);
  });

  it("refuses a fractional duration, because a turn is a whole thing", () => {
    expect(validatePeaceTerm({ kind: "demilitarisation", turns: 2.5 }, ctx).ok).toBe(false);
  });
});

describe("validatePeaceTerm: white peace", () => {
  it("is always valid, carrying no fields that could be wrong", () => {
    expect(validatePeaceTerm({ kind: "white_peace" }, ctx)).toEqual({ ok: true });
  });

  it("is valid even against a country with no GDP on record", () => {
    // Nothing is being sized against anything, so the indemnity ceiling that would
    // refuse a payer with no GDP has nothing to say here.
    expect(validatePeaceTerm({ kind: "white_peace" }, { ...ctx, maxIndemnity: null })).toEqual({
      ok: true,
    });
  });
});

describe("validatePeaceTerm: reunification", () => {
  const term: PeaceTerm = { kind: "reunification" };
  /** DD is the challenger of the German Question frozen on this war. */
  const gq: PeaceTermContext = {
    from: "DD",
    to: "US",
    target: "US",
    targetSystem: "presidential",
    maxIndemnity: null,
    settlement: { challenger: "DD" },
  };

  it("accepts it from the challenger on a German Question war", () => {
    expect(validatePeaceTerm(term, gq)).toEqual({ ok: true });
  });

  it("refuses it on a war that carries no German Question", () => {
    const res = validatePeaceTerm(term, { ...gq, settlement: null });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/German Question/i);
  });

  it("refuses it when the challenger is neither party to the deal", () => {
    // Shared with the IMPOSE road, which never runs `validatePeaceOffer` and so has
    // no other check standing between it and settling Germany over the head of the
    // country whose outcome it is.
    const res = validatePeaceTerm(term, { ...gq, from: "RU", to: "US" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/East Germany|challenger|party/i);
  });

  it("refuses it when the caller did not load the settlement at all", () => {
    // Fails CLOSED, unlike maxIndemnity and targetPartyIds: a term whose whole
    // meaning is the crisis cannot be waved through when the crisis is unknown.
    const { settlement: _omitted, ...withoutSettlement } = gq;
    const res = validatePeaceTerm(term, withoutSettlement);
    expect(res.ok).toBe(false);
  });

  it("accepts it from the incumbent side too", () => {
    // EITHER founding belligerent may put it on the table. From the incumbent it is
    // an offer to concede: the outcome is still the challenger's, and who composed
    // the offer does not change what it settles.
    expect(validatePeaceTerm(term, { ...gq, from: "US", to: "DD" })).toEqual({ ok: true });
  });
});
