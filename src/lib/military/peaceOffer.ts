import type { Db } from "mongodb";
import type { ConflictDoc } from "@/lib/db/types/conflict";
import { principalOf } from "./principal";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import type { CountryId, GovernmentType } from "@/lib/constants/countries";
import { validatePeaceTerm, type PeaceTerm } from "@/lib/military/peaceTerm";
import { isConflictConcluded } from "@/lib/military/conflictLifecycle";
import { opposedBelligerents, progressForSide, type Side } from "@/lib/military/occupation";

export type PeaceOfferCheck = { ok: true } | { ok: false; error: string };

/**
 * Ceiling on an indemnity, as a multiple of the PAYER's annual GDP.
 *
 * The amount is otherwise unbounded: the body schema only rejects negatives and
 * affordability is deliberately not checked (a country may buy peace on debt).
 * Without a ceiling a foreign-seat holder can post `amount: 1e15`, and on accept
 * `moveIndemnity` drives the payer treasury arbitrarily negative and credits the
 * recipient the converted sum — a one-request self-bankrupting grief, or a
 * collusion pump into a chosen treasury. Anchoring to the payer's own GDP (the
 * same denomination-agnostic basis military procurement uses) keeps even a harsh
 * reparation finite and tied to the real economy paying it. 2× GDP is a very
 * large but bounded reparation.
 */
export const PEACE_INDEMNITY_MAX_GDP_SHARE = 2;

/**
 * How far the front must have moved in your favour before you may demand a
 * withdrawal that would END the war.
 *
 * Front progress from the STARTING line, 0..1, not absolute ground: an interstate
 * war opens with the defender holding all of its own soil, so an absolute reading
 * would call every invasion deep before the first shot.
 *
 * Set to the same value as `OCCUPATION.deepPushDepth`, so the rule reads as "once
 * the war is visibly winding down in your favour, you may ask them to quit" and a
 * player can see the threshold coming on the conflicts board. Kept as its OWN
 * constant rather than reusing that one: they answer different questions, and tuning
 * when a war looks like it is ending should not silently move who can be bought out
 * of it.
 *
 * BALANCE CONSTANT. Changing it needs an issue and a simulation report.
 */
export const PRINCIPAL_BUYOUT_PROGRESS = 0.75;

/**
 * The indemnity ceiling for a payer with the given GDP, or null when GDP is
 * missing/non-positive (no assumed fallback — same stance as `unitPurchasePrice`,
 * where an assumed GDP is how a country ends up transacting for free).
 */
export function maxIndemnityForGdp(gdp: number | null | undefined): number | null {
  if (gdp == null || !(gdp > 0)) return null;
  return gdp * PEACE_INDEMNITY_MAX_GDP_SHARE;
}

/**
 * Is this offer still open?
 *
 * Expiry is LAZY — derived here rather than swept by a scheduled job, which would
 * exist only to flip a field every reader can already compute. The consequence is
 * that a stored `status` of "pending" is NOT sufficient: a row whose `expiresTurn`
 * has passed is expired regardless of what it says. Any reader comparing
 * `status === "pending"` without also checking the turn is a bug, which is why this
 * helper exists instead of the check being inlined at each call site.
 */
export function isOfferLive(
  offer: Pick<PeaceOfferDoc, "status" | "expiresTurn">,
  currentTurn: number
): boolean {
  return offer.status === "pending" && currentTurn < offer.expiresTurn;
}

/**
 * The side that would be left with nobody on it if these countries walked away, or null.
 *
 * Used to decide whether accepting a peace deal also ends the war outright. Both
 * sides can never empty at once: emptying one resolves the conflict.
 *
 * Takes a SET, not one country. Treaty release removes an auto-joined ally at the same
 * moment as the member it was defending, so a two-country side can empty in a single
 * `acceptPeace` call. Asked about the principal alone this returned null and the war was
 * left `active` with an empty roster and no victor.
 */
export function sideWouldEmpty(
  c: Pick<ConflictDoc, "sideA" | "sideB">,
  leavers: CountryId | CountryId[]
): Side | null {
  const gone = new Set<string>(Array.isArray(leavers) ? leavers : [leavers]);
  const a = c.sideA.countries as string[];
  const b = c.sideB.countries as string[];
  // `length > 0` is load-bearing, not defensive: a generated side carries an EMPTY
  // roster, and `[].every(...)` is vacuously true, so without the guard every
  // insurgency would read as a side that had just emptied.
  if (a.length > 0 && a.every((x) => gone.has(x))) return "A";
  if (b.length > 0 && b.every((x) => gone.has(x))) return "B";
  return null;
}

export interface WithdrawalGate {
  /**
   * True when this departure hands the asker the war, by EITHER road: it empties the
   * leaver's roster, or it is a principal-to-principal settlement, which ends the war
   * for every guest on both sides without either roster running out.
   */
  endsWar: boolean;
  /**
   * WHICH road, so copy describing the consequence can be true.
   *
   * `roster` leaves nobody behind on the losing side; `principals` ends the war with
   * that side's allies still on it, which is the opposite picture. A reader told the
   * roster story about a principal settlement is told something plainly false.
   */
  endsWarReason: "roster" | "principals" | null;
  /**
   * Treaty allies released alongside this country, because they were pulled in to
   * defend it. They leave with it, which is how one departure can empty a side that
   * still looks populated.
   */
  guests: CountryId[];
  /** Front progress in the ASKER's favour, 0..1. */
  progress: number;
  /** Progress a war-ending withdrawal requires. */
  required: number;
  /**
   * True when a withdrawal this deep would be refused. A white peace is exempt and
   * is NOT considered here: the caller decides whether the term escapes the gate,
   * because the offer form needs to say "blocked, unless you offer a white peace".
   */
  blocked: boolean;
}

/**
 * Whether asking `leaver` to withdraw would end the war, and whether the asker has
 * the ground to demand it.
 *
 * SHARED BY THE VALIDATOR AND THE OFFER FORM, deliberately. The form has to grey the
 * option out and say why before a player composes a whole offer that the route would
 * refuse, and a rule with two implementations is a rule that drifts. The server stays
 * the authority: this is the same function the POST runs.
 */
/** Which roster holds this country, or null when neither does. */
function rosterSideOf(
  conflict: Pick<ConflictDoc, "sideA" | "sideB">,
  country: CountryId
): Side | null {
  if ((conflict.sideA.countries as string[]).includes(country)) return "A";
  if ((conflict.sideB.countries as string[]).includes(country)) return "B";
  return null;
}

export function withdrawalGate(
  conflict: Pick<
    ConflictDoc,
    "sideA" | "sideB" | "treatyEntries" | "joinTurns" | "control" | "controlStart"
  >,
  asker: CountryId,
  leaver: CountryId
): WithdrawalGate {
  // Treaty guests go out with the country they came to defend, so a departure can
  // empty a side even when the roster looks like it has people left on it.
  const guests = (conflict.treatyEntries ?? [])
    .filter((e) => e.defending === leaver)
    .map((e) => e.countryId as CountryId);

  const side: Side = (conflict.sideA.countries as string[]).includes(asker) ? "A" : "B";
  const leaverSide: Side = (conflict.sideA.countries as string[]).includes(leaver) ? "A" : "B";

  // A principal-to-principal settlement ends the war for everyone (`acceptPeace`),
  // so demanding the opposing FOUNDER quit buys the war just as completely as
  // emptying its roster would — and has to clear the same bar. Asking a mere joiner
  // to leave decides nothing and stays ungated however the front looks.
  const bothPrincipals =
    principalOf(conflict, leaverSide) === leaver &&
    principalOf(conflict, leaverSide === "A" ? "B" : "A") === asker;
  // Roster first: when a departure does both, "nobody is left on that side" is the
  // more concrete thing to tell the reader.
  const endsWarReason: WithdrawalGate["endsWarReason"] =
    sideWouldEmpty(conflict, [leaver, ...guests]) !== null
      ? "roster"
      : bothPrincipals
        ? "principals"
        : null;
  const endsWar = endsWarReason !== null;
  const progress = progressForSide(
    side,
    conflict.control ?? 50,
    conflict.controlStart ?? conflict.control ?? 50
  );

  return {
    endsWar,
    endsWarReason,
    guests,
    progress,
    required: PRINCIPAL_BUYOUT_PROGRESS,
    blocked: endsWar && progress < PRINCIPAL_BUYOUT_PROGRESS,
  };
}

/**
 * Every rule an offer must clear, with a reason the offerer can act on.
 *
 * Pure — no DB. Deliberately does NOT check affordability: `treasuryBalance` is a
 * signed position and is legitimately negative, so requiring a surplus would mean a
 * country already in debt could never buy peace, which rules out most of the
 * countries that would want to.
 */
/** One party the offerer may install as the ruling party. */
export interface PeaceTermPartyChoice {
  /** `sequentialId` — what the term carries and `installOnePartyState` reads. */
  id: number;
  name: string;
  abbreviation?: string;
}

/**
 * Every party in a country, for naming a ruling party on a `regime_change` term.
 *
 * One loader behind both uses — the picker the offerer chooses from and the list
 * their choice is validated against — so a party that can be picked is by
 * construction a party that will be accepted.
 *
 * Sorted by `sequentialId` so the list reads the same on every render rather
 * than in whatever order Mongo returned it.
 */
export async function loadPartyChoices(
  db: Db,
  countryId: CountryId
): Promise<PeaceTermPartyChoice[]> {
  return (await loadPartyChoicesFor(db, [countryId])).get(countryId) ?? [];
}

/**
 * The same, for several countries in ONE query.
 *
 * The peace panel lists every country that could be offered terms across every
 * war a nation is fighting — ten of them in the live German war alone — and a
 * lookup per country turns one page load into ten round trips. A country
 * fighting on two fronts is still one entry here.
 *
 * Every requested country gets a key, empty array included, so a caller can tell
 * "no parties" from "not loaded" without a second existence check.
 */
export async function loadPartyChoicesFor(
  db: Db,
  countryIds: CountryId[]
): Promise<Map<CountryId, PeaceTermPartyChoice[]>> {
  const wanted = [...new Set(countryIds)];
  const out = new Map<CountryId, PeaceTermPartyChoice[]>(wanted.map((id) => [id, []]));
  if (wanted.length === 0) return out;

  const parties = (await db
    .collection("politicalParties")
    .find(
      { countryId: { $in: wanted } },
      { projection: { countryId: 1, sequentialId: 1, name: 1, abbreviation: 1 } }
    )
    .toArray()) as unknown as Array<{
    countryId?: CountryId;
    sequentialId?: number;
    name?: string;
    abbreviation?: string;
  }>;

  for (const party of parties) {
    if (typeof party.sequentialId !== "number" || !Number.isInteger(party.sequentialId)) continue;
    const bucket = party.countryId ? out.get(party.countryId) : undefined;
    if (!bucket) continue;
    bucket.push({
      id: party.sequentialId,
      name: party.name ?? party.abbreviation ?? `Party ${party.sequentialId}`,
      ...(party.abbreviation ? { abbreviation: party.abbreviation } : {}),
    });
  }
  // Sorted by `sequentialId` so the list reads the same on every render rather
  // than in whatever order Mongo returned it.
  for (const bucket of out.values()) bucket.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * How a named ruling party reads to a player, or null when the list does not
 * hold it.
 *
 * ONE definition, because the party a settlement installs is reported on three
 * surfaces — the offer panel, the war record and the news wire — and they must
 * not disagree about what to call it. The abbreviation is preferred (a field
 * value and a sentence clause both want "SED", not the full name), with the full
 * name as the fallback for a party that carries no abbreviation. Null means the
 * id names nothing in this country, which reads as "no party was named" rather
 * than as a broken lookup.
 */
export function partyDisplayName(
  choices: PeaceTermPartyChoice[] | undefined,
  partyId: number
): string | null {
  const party = choices?.find((p) => p.id === partyId);
  if (!party) return null;
  return party.abbreviation ?? party.name;
}

/**
 * The `sequentialId`s alone, for validating a named ruling party.
 *
 * Callers load this only when the term actually names a party — an indemnity
 * should not pay for a query it never reads.
 */
export async function loadPartySequentialIds(db: Db, countryId: CountryId): Promise<number[]> {
  return (await loadPartyChoices(db, countryId)).map((p) => p.id);
}

export function validatePeaceOffer(
  conflict: Pick<
    ConflictDoc,
    "status" | "sideA" | "sideB" | "treatyEntries" | "joinTurns" | "control" | "controlStart"
  >,
  from: CountryId,
  to: CountryId,
  term: PeaceTerm,
  /** Which of the two this deal removes. `from` is the original "let me out" shape. */
  leaver: CountryId,
  // The payer's indemnity ceiling (see `maxIndemnityForGdp`). Optional so a caller
  // without the payer's GDP to hand can still run the roster/side checks, but the
  // POST (offer) and accept paths both pass it so an over-cap amount is refused at
  // creation AND re-refused at acceptance in case GDP has since fallen.
  maxAmount?: number | null,
  // The target's CURRENT government type, so a regime change that would change
  // nothing can be refused. Optional for the same reason `maxAmount` is: a caller
  // running only the roster checks need not load it.
  targetSystem?: GovernmentType,
  // The target's party `sequentialId`s, so a named ruling party can be checked
  // against the country it would rule. Optional for the same reason as the two
  // above; `validatePeaceTerm` skips the check rather than failing when absent.
  targetPartyIds?: number[] | null,
  // The settlement crisis riding this war, for a term that settles one. Unlike the
  // three above, absence REFUSES rather than skipping the check — see
  // `PeaceTermContext.settlement` for why this one fails closed.
  settlement?: { challenger: CountryId } | null
): PeaceOfferCheck {
  // Concluded covers a war awaiting terms as well as a resolved one. A front that
  // has reached a pole is not a war anyone can still negotiate their way out of:
  // the victor is choosing what to take, and an offer accepted underneath that
  // would settle a war that has already been won.
  if (isConflictConcluded(conflict.status)) {
    return { ok: false, error: "That war is already over." };
  }

  // Checked BEFORE roster membership, because a generated side is defined by an
  // EMPTY roster (`countries: []` — see ConflictSide). Test it second and every
  // insurgency would fail the membership check instead, telling the offerer their
  // enemy "must be a belligerent" when the truth is that there is no government on
  // the other side to address an offer to.
  if (conflict.sideA.kind === "generated" || conflict.sideB.kind === "generated") {
    return { ok: false, error: "There is no government on the other side to negotiate with." };
  }

  const rosters = [...conflict.sideA.countries, ...conflict.sideB.countries] as string[];
  if (!rosters.includes(from) || !rosters.includes(to)) {
    return { ok: false, error: "Both countries must be belligerents in that war." };
  }
  // Roster-only, via the same predicate the one-war-per-pair rule uses, so war and
  // peace cannot drift on what "at war with each other" means. `sideOf` would be
  // wrong here: its bloc fallback would call two bloc rivals opposed in a war neither
  // had joined, and offer a settlement for it.
  if (!opposedBelligerents(conflict, from, to)) {
    return { ok: false, error: "You are on the same side of that war." };
  }

  // THE SEPARATE-PEACE TREATY BAR IS GONE, deliberately, and this is where it stood.
  //
  // It refused any offer from a country a treaty had dragged in, so a guarantee it
  // never chose kept it in the war until the member it came to defend settled. Its
  // stated worry was that "an aggressor peels the coalition apart one member at a
  // time and the guarantee is theatre" — but peeling is now a thing the aggressor
  // must PAY for and the guest must AGREE to, which is a price rather than a
  // formality. Enforced mutual defence still drags you in; it no longer holds you
  // there with no way out.
  //
  // What replaces it is the buy-out gate below, which stops the one case the bar was
  // really protecting: ending a war outright by cheque.

  if (leaver !== from && leaver !== to) {
    return { ok: false, error: "Only one of the two parties can leave under a deal." };
  }

  // THE BUY-OUT GATE. Asking the other side to withdraw is ordinary coalition
  // politics right up until the withdrawal would EMPTY their side, at which point it
  // is not a settlement at all, it is buying the war. Gated on the ground rather than
  // forbidden: once the front is deep enough that the war is visibly going your way,
  // demanding they quit is a real thing to demand.
  //
  // Keyed on what the departure DOES, not on who it names. Gating on "is the target
  // the principal" would wave through the case where the target is a mere ally who
  // happens to be the last one standing, which wins the war just as completely.
  //
  // A WHITE PEACE IS ALWAYS EXEMPT. It records no victor and moves nothing, so
  // nothing is bought: a war fought over a question ends with the question still
  // open rather than answered in the buyer's favour.
  //
  // A REUNIFICATION IS EXEMPT TOO, and for a different reason than the white peace.
  // The white peace is exempt because it buys nothing. This one plainly does buy
  // something, but it is not COERCIVE: the recipient must accept it, refusing costs
  // them nothing, and what is on the table is the very question the war is being
  // fought over rather than a cheque for it. Gating it on the front would also make
  // the term unofferable in practice: a reunification the challenger withdraws under
  // is barred below, so every reunification offer asks the other side to leave, and
  // every one of them would meet this gate.
  if (
    leaver === to &&
    term.kind !== "white_peace" &&
    term.kind !== "reunification" &&
    withdrawalGate(conflict, from, to).blocked
  ) {
    return {
      ok: false,
      error:
        "That withdrawal would end the war outright, and your armies are not far " +
        "enough forward to demand it. Push the front further, or offer a white peace.",
    };
  }

  // A REUNIFICATION THE CHALLENGER WITHDRAWS UNDER IS A CONTRADICTION, and it is
  // checked here rather than in `validatePeaceTerm` because only the offer knows who
  // is leaving. The departure hands the war to the incumbent (the leaver's side is the
  // losing one) while the term settles the question for the challenger. Left open it
  // is not merely incoherent, it is an exploit: the challenger wins the German
  // Question by surrendering the war fought over it.
  if (term.kind === "reunification" && settlement) {
    // EITHER FOUNDING BELLIGERENT MAY PROPOSE IT, and only they: from the challenger
    // it is a demand, from the incumbent a capitulation, and the outcome is the
    // challenger's either way. A guest cannot settle the question its principal is
    // fighting over, and neither can it be settled AT one: a deal the opposing
    // founder is not party to would decide Germany over their head.
    //
    // Checked here rather than in `validatePeaceTerm` because "founding belligerent"
    // is a fact about the rosters, which that pure function does not hold.
    const fromSide = rosterSideOf(conflict, from);
    const toSide = rosterSideOf(conflict, to);
    if (
      fromSide === null ||
      toSide === null ||
      principalOf(conflict, fromSide) !== from ||
      principalOf(conflict, toSide) !== to
    ) {
      return {
        ok: false,
        error: "Only the two countries that started this war can settle Germany between them.",
      };
    }
    // NOTE: "the challenger must be at the table" is NOT checked here. It is
    // roster-free, so it lives in `validatePeaceTerm` where the impose road sees it
    // too — that road never runs this function, and a rule only the offer road
    // enforces is a rule with a second door.
    // A REUNIFICATION THE CHALLENGER WITHDRAWS UNDER IS A CONTRADICTION. The
    // departure hands the war to the incumbent (the leaver's side is the losing one)
    // while the term settles the question for the challenger. Left open it is not
    // merely incoherent, it is an exploit: the challenger wins the German Question by
    // surrendering the war fought over it. So the incumbent is always the one who
    // leaves, whichever of the two composed the offer.
    if (leaver === settlement.challenger) {
      return {
        ok: false,
        error:
          "Reunification cannot be settled by a deal East Germany withdraws from the war under.",
      };
    }
  }

  // The term's own rules live in `validatePeaceTerm`, shared with the impose route
  // so a term refused when it is offered is refused again when it is applied. The
  // checks above are about the WAR and stay here; the checks below are about the
  // TERM and belong to it.
  return validatePeaceTerm(term, {
    from,
    to,
    // The term always lands on the country being offered to. `from` is the leaver,
    // and a settlement it proposes is a settlement imposed on the other party.
    target: to,
    // Defaulted only when the caller ran without loading it. `validatePeaceTerm`
    // uses it solely to refuse a no-op conversion, so the fallback can never turn
    // an invalid term into a valid one, only the reverse.
    targetSystem: targetSystem ?? "presidential",
    maxIndemnity: maxAmount ?? null,
    targetPartyIds: targetPartyIds ?? null,
    settlement: settlement ?? null,
  });
}
