import { describe, expect, it } from "vitest";
import {
  AD_AGREEMENT_TERM_VERSION,
  acceptedTerm,
  cancelEffectiveTurnFor,
  isTurnInTerm,
  normalizeAgreementTerm,
} from "./term";
import { isAgreementSettling } from "../types";

function settlingTurns(
  status: "active" | "cancelling",
  stored: Parameters<typeof normalizeAgreementTerm>[0],
  from: number,
  to: number
): number[] {
  const out: number[] = [];
  for (let t = from; t <= to; t++) {
    if (isAgreementSettling({ status, ...stored }, t)) out.push(t);
  }
  return out;
}

describe("advertising term window", () => {
  it.each([1, 4])("settles an %i-turn contract exactly that many times", (n) => {
    const term = acceptedTerm(100, n);
    expect(term.startsAtTurn).toBe(101);
    const stored = { ...term, termVersion: AD_AGREEMENT_TERM_VERSION };
    const turns = settlingTurns("active", stored, 95, 120);
    expect(turns).toEqual(Array.from({ length: n }, (_, i) => 101 + i));
    expect(isTurnInTerm(normalizeAgreementTerm(stored), 100)).toBe(false);
    expect(isTurnInTerm(normalizeAgreementTerm(stored), 101 + n)).toBe(false);
  });

  it("settles a cancellation notice of K turns exactly K more turns", () => {
    const K = 4;
    const stored = {
      ...acceptedTerm(100, 40),
      termVersion: AD_AGREEMENT_TERM_VERSION,
      cancelEffectiveTurn: cancelEffectiveTurnFor(110, K),
    };
    expect(settlingTurns("cancelling", stored, 108, 130)).toEqual(
      [108, 109, 110, 111, 112, 113, 114].filter((t) => t <= 114)
    );
    expect(settlingTurns("cancelling", stored, 111, 130)).toEqual([111, 112, 113, 114]);
  });

  it("leaves open-ended agreements settling from the first unsettled turn", () => {
    const stored = { ...acceptedTerm(100), termVersion: AD_AGREEMENT_TERM_VERSION };
    expect(isAgreementSettling({ status: "active", ...stored }, 100)).toBe(false);
    expect(isAgreementSettling({ status: "active", ...stored }, 101)).toBe(true);
    expect(isAgreementSettling({ status: "active", ...stored }, 5000)).toBe(true);
  });

  it("gives legacy in-flight documents their full term", () => {
    // Legacy accept at turn 100, 4 turns: stored start 100, expiry 104.
    const legacy = { startsAtTurn: 100, expiresAtTurn: 104 };
    expect(settlingTurns("active", legacy, 95, 120)).toEqual([101, 102, 103, 104]);
    const legacyCancel = { ...legacy, expiresAtTurn: 200, cancelEffectiveTurn: 114 };
    expect(settlingTurns("cancelling", legacyCancel, 108, 130)).toEqual(
      [108, 109, 110, 111, 112, 113, 114].filter((t) => t <= 114)
    );
  });
});
