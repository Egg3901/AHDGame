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
  /**
   * Status quo ante. Neither side prevails, nothing changes hands, and the war
   * record shows no victor.
   *
   * DISTINCT from an indemnity of zero, which is a settlement one side imposed and
   * chose to take nothing from: that one still names a winner. A white peace names
   * none, and that difference is load-bearing where a war is being fought over a
   * question, because a question decided by nobody goes back to being a question.
   */
  | { kind: "white_peace" }
  | { kind: "indemnity"; payer: CountryId; amount: number }
  /**
   * Convert the target's system of government.
   *
   * `rulingPartyId` names the party that takes power, and is meaningful ONLY
   * when `targetSystem` is `onePartyState` — the other systems form a government
   * from the chamber rather than having one installed. Optional: omitted, the
   * install resolves the ruling party from the target's own formed government or
   * largest bench, which is the shipped behaviour.
   *
   * The victor naming it matters. Left to resolve, a `regime_change` imposed on
   * a country whose largest party is the one the victor just fought hands that
   * party a monopoly and bans its rivals — the settlement installs the enemy.
   */
  | { kind: "regime_change"; targetSystem: GovernmentType; rulingPartyId?: number }
  | { kind: "demilitarisation"; turns: number }
  /**
   * German reunification, on the challenger's terms.
   *
   * Carries no fields: the settlement crisis already names the two Germanies, and a
   * term that restated them could disagree with it. Only valid on a war the German
   * Question is riding, and only from the crisis CHALLENGER, because reunification
   * is the challenger's outcome. The incumbent winning the question leaves both
   * Germanies standing, which is the absence of a term rather than one to impose.
   *
   * Deliberately UNGATED on the front. Every other way to reach this outcome runs
   * through winning the war; this is the one that can be put on the table while it
   * is still being fought, which is the point of having it.
   */
  | { kind: "reunification" };

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

/**
 * Player-facing names for the systems a settlement may install.
 *
 * ONE table, because the raw `GovernmentType` is camelCase and had been reaching
 * players verbatim through the war wire ("Regime change: onePartyState"). The
 * pickers carry the same strings, so a term reads identically where it is chosen
 * and where it is reported.
 */
/**
 * EXHAUSTIVE over the union, deliberately: a fifth system added to
 * `GovernmentType` should fail this file to compile rather than quietly start
 * printing its own key at players, which is the failure this table exists to
 * end.
 */
export const GOVERNMENT_SYSTEM_LABELS: Record<GovernmentType, string> = {
  parliamentaryRepublic: "parliamentary republic",
  presidential: "presidential republic",
  onePartyState: "one-party state",
  parliamentaryMonarchy: "constitutional monarchy",
};

/**
 * A system's player-facing name.
 *
 * Takes a plain `string`, not `GovernmentType`, because most callers are reading
 * the value off a stored document or an API payload where it is typed loosely —
 * and those are exactly the surfaces that were printing the raw key. Narrowing
 * the parameter would push a cast onto every one of them.
 *
 * The fallback is not dead code even with an exhaustive table: a row written
 * before a system was renamed can hold a key the table no longer has. Showing
 * the raw key is a poor label but a better outcome than rendering "undefined".
 */
export function governmentSystemLabel(system: GovernmentType | string): string {
  return GOVERNMENT_SYSTEM_LABELS[system as GovernmentType] ?? system;
}

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
  /**
   * The target's party `sequentialId`s, for validating a named ruling party.
   *
   * Null means "no list passed", matching `maxIndemnity`'s stance: the check is
   * skipped rather than failed, so a caller that cannot cheaply load the list
   * does not have every `regime_change` refused. Callers that CAN load it always
   * pass it, and `applyPeaceTerm` degrades safely either way —
   * `installOnePartyState` ignores a `rulingPartyId` that names no party of the
   * country.
   */
  targetPartyIds?: number[] | null;
  /**
   * The settlement crisis riding THIS war, when one is.
   *
   * ⚠️ Unlike `maxIndemnity` and `targetPartyIds`, absence FAILS CLOSED. Those two
   * skip a check when the caller could not cheaply load them, which can only ever
   * refuse a valid term. Here the crisis IS the term's whole meaning, so treating
   * "not loaded" as "no objection" would let a reunification through on a war that
   * has nothing to do with Germany. Callers that can offer the term always load it.
   */
  settlement?: { challenger: CountryId } | null;
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
  // A white peace carries no fields, so there is nothing about it that can be
  // invalid. Always available: walking away unchanged is a legitimate end to any
  // war, including one you are winning.
  if (term.kind === "white_peace") return { ok: true };

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

  if (term.kind === "reunification") {
    // Both roads to this term load the crisis, so a missing one is a war that is not
    // carrying the German Question rather than a caller that skipped a query.
    if (!ctx.settlement) {
      return {
        ok: false,
        error: "Reunification can only be settled on a war the German Question is riding.",
      };
    }
    // THE CHALLENGER MUST BE AT THE TABLE, and this check lives HERE rather than in
    // `validatePeaceOffer` because the IMPOSE road never runs that function. Left
    // there, a victor and a loser who are neither of them the challenger could
    // reunify Germany between themselves, deciding the question over the head of the
    // country whose outcome it is. Roster-free, so this pure function can make it.
    if (ctx.from !== ctx.settlement.challenger && ctx.to !== ctx.settlement.challenger) {
      return {
        ok: false,
        error: "Germany cannot be reunified by a settlement East Germany is not a party to.",
      };
    }
    // WHICH of the two proposes it is not decided here. Either founding belligerent
    // may, and "founding" is a fact about the war's rosters that this pure function
    // cannot see: `validatePeaceOffer` holds the conflict and makes that check. The
    // outcome is the challenger's either way, so a proposal from the incumbent is a
    // concession rather than a different settlement.
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
    if (term.rulingPartyId != null) {
      // Only a one-party state HAS a ruling party to name. Naming one alongside
      // a conversion to a republic is a contradiction, not a field to ignore:
      // the offerer plainly meant something the term cannot deliver.
      if (term.targetSystem !== "onePartyState") {
        return {
          ok: false,
          error: "Only a conversion to a one-party state can name the ruling party.",
        };
      }
      if (!Number.isInteger(term.rulingPartyId) || term.rulingPartyId <= 0) {
        return { ok: false, error: "That is not a valid party." };
      }
      if (ctx.targetPartyIds != null && !ctx.targetPartyIds.includes(term.rulingPartyId)) {
        return { ok: false, error: "That party does not exist in the country being converted." };
      }
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
