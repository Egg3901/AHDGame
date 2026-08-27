import type { CountryId, GovernmentType } from "@/lib/constants/countries";

/**
 * What a settlement takes.
 *
 * A DISCRIMINATED UNION, not an object with three optional branches: exactly one
 * shape is representable at a time, so a settlement carrying two terms cannot be
 * constructed, stored, or hand-rolled over the API. "Pick one" is a schema rule
 * here rather than a convention the UI is trusted to keep.
 *
 * Spec: docs/superpowers/specs/2026-08-27-peace-terms-design.md
 */
export type PeaceTerm =
  | { kind: "indemnity"; payer: CountryId; amount: number }
  | { kind: "regime_change"; targetSystem: GovernmentType }
  | { kind: "demilitarisation"; turns: number };

/**
 * Default demilitarisation length, in turns. Matches `TRUCE_TURNS`, so the bar on
 * re-arming and the bar on re-declaring lapse together.
 *
 * BALANCE CONSTANT. Changing it needs an issue and a simulation report.
 */
export const DEMILITARISATION_DEFAULT_TURNS = 240;

/**
 * Ceiling on a demilitarisation, in turns.
 *
 * Exists for the same reason the indemnity has a GDP ceiling: the field is
 * otherwise bounded only by "positive", and a foreign seat holder could post a
 * duration that outlives the world. BALANCE CONSTANT.
 */
export const DEMILITARISATION_MAX_TURNS = 480;

export interface PeaceTermContext {
  /** The country offering or imposing. */
  from: CountryId;
  /** The other party to the deal. */
  to: CountryId;
  /** The country the term lands on. */
  target: CountryId;
  /** The target's CURRENT government type, so a no-op conversion can be refused. */
  targetSystem: GovernmentType;
  /**
   * The payer's indemnity ceiling, or null when they have no usable GDP.
   *
   * Null means "no ceiling passed", matching `validatePeaceOffer`'s existing
   * stance on a missing `maxAmount`. It never loosens a real cap: a caller that
   * knows the GDP always passes the number.
   */
  maxIndemnity: number | null;
}

export type PeaceTermCheck = { ok: true } | { ok: false; error: string };

/**
 * Every rule a term must clear, with a reason the offerer can act on.
 *
 * Pure, and shared by the offer route, the impose route and the accept path, so a
 * term refused at creation is refused again at application. Deliberately does NOT
 * check affordability: `treasuryBalance` is a signed position and is legitimately
 * negative, so requiring a surplus would mean a country already in debt could
 * never buy peace, which rules out most of the countries that would want to.
 */
export function validatePeaceTerm(term: PeaceTerm, ctx: PeaceTermContext): PeaceTermCheck {
  if (term.kind === "indemnity") {
    // `>= 0` rather than `!(< 0)`: NaN fails both comparisons, and the negated
    // form would let it through to become a NaN treasury balance.
    if (!Number.isFinite(term.amount) || !(term.amount >= 0)) {
      return { ok: false, error: "An indemnity cannot be negative." };
    }
    if (term.payer !== ctx.from && term.payer !== ctx.to) {
      return { ok: false, error: "Only one of the two parties can pay the indemnity." };
    }
    if (ctx.maxIndemnity != null && term.amount > ctx.maxIndemnity) {
      return {
        ok: false,
        error: "An indemnity cannot exceed twice the paying country's annual GDP.",
      };
    }
    return { ok: true };
  }

  if (term.kind === "regime_change") {
    if (term.targetSystem === ctx.targetSystem) {
      return { ok: false, error: "That country already has that system of government." };
    }
    // A war can topple a government. It cannot invent a monarchy: there is no
    // dynasty to seat, and `imperialCharacters` is not a document a treaty writes.
    // Converting a monarchy AWAY is allowed; only installing one is barred.
    if (term.targetSystem === "parliamentaryMonarchy") {
      return { ok: false, error: "A peace settlement cannot install a monarchy." };
    }
    return { ok: true };
  }

  if (!Number.isInteger(term.turns) || term.turns <= 0) {
    return { ok: false, error: "A demilitarisation must last at least one whole turn." };
  }
  if (term.turns > DEMILITARISATION_MAX_TURNS) {
    return { ok: false, error: "That demilitarisation is longer than any settlement allows." };
  }
  return { ok: true };
}

/**
 * One line of player-facing copy for a term.
 *
 * No em or en dashes, no calendar years, and no anchor units: an indemnity's
 * figure is deliberately absent here because it is denominated in the payer's own
 * currency and needs the caller's formatter to render honestly.
 */
export function describePeaceTerm(term: PeaceTerm): string {
  if (term.kind === "indemnity") {
    return term.amount > 0 ? "An indemnity is paid." : "A white peace. No money changes hands.";
  }
  if (term.kind === "regime_change") {
    return "The government falls and fresh elections are called.";
  }
  return `New defence procurement is frozen for ${term.turns} turns.`;
}
