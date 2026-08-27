import { describe, it, expect } from "vitest";
import {
  validatePeaceTerm,
  describePeaceTerm,
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

describe("describePeaceTerm", () => {
  const terms: PeaceTerm[] = [
    { kind: "indemnity", payer: "TR", amount: 100 },
    { kind: "indemnity", payer: "TR", amount: 0 },
    { kind: "regime_change", targetSystem: "presidential" },
    { kind: "demilitarisation", turns: 240 },
  ];

  it("describes every kind", () => {
    for (const term of terms) {
      expect(describePeaceTerm(term).length).toBeGreaterThan(0);
    }
  });

  it("uses no em dash or en dash, which player-facing copy bars", () => {
    for (const term of terms) {
      expect(describePeaceTerm(term)).not.toMatch(/[—–]/);
    }
  });

  it("names a white peace as one rather than as a payment of nothing", () => {
    expect(describePeaceTerm({ kind: "indemnity", payer: "TR", amount: 0 })).toMatch(
      /white peace/i
    );
  });

  it("states the demilitarisation length in turns", () => {
    expect(describePeaceTerm({ kind: "demilitarisation", turns: 240 })).toContain("240 turns");
  });
});
