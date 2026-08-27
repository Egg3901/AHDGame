import type { ConflictDoc } from "@/lib/db/types/conflict";
import type { PeaceOfferDoc } from "@/lib/db/types/peaceOffer";
import { COUNTRY_CONFIGS, type CountryId, type GovernmentType } from "@/lib/constants/countries";
import { validatePeaceTerm, type PeaceTerm } from "@/lib/military/peaceTerm";
import { INTERNATIONAL_ORGANIZATIONS } from "@/lib/constants/internationalOrganizations";
import { opposedBelligerents, type Side } from "@/lib/military/occupation";

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

/**
 * Every rule an offer must clear, with a reason the offerer can act on.
 *
 * Pure — no DB. Deliberately does NOT check affordability: `treasuryBalance` is a
 * signed position and is legitimately negative, so requiring a surplus would mean a
 * country already in debt could never buy peace, which rules out most of the
 * countries that would want to.
 */
export function validatePeaceOffer(
  conflict: Pick<ConflictDoc, "status" | "sideA" | "sideB" | "treatyEntries">,
  from: CountryId,
  to: CountryId,
  term: PeaceTerm,
  // The payer's indemnity ceiling (see `maxIndemnityForGdp`). Optional so a caller
  // without the payer's GDP to hand can still run the roster/side checks, but the
  // POST (offer) and accept paths both pass it so an over-cap amount is refused at
  // creation AND re-refused at acceptance in case GDP has since fallen.
  maxAmount?: number | null,
  // The target's CURRENT government type, so a regime change that would change
  // nothing can be refused. Optional for the same reason `maxAmount` is: a caller
  // running only the roster checks need not load it.
  targetSystem?: GovernmentType
): PeaceOfferCheck {
  if (conflict.status === "resolved") {
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

  // Enforced mutual defence: a country pulled in by a treaty cannot buy its way out while
  // the member it came to defend is still fighting. Without this an aggressor peels the
  // coalition apart one member at a time and the guarantee is theatre.
  //
  // Checked on `from` and not `to`: acceptPeace sets `leaver = offer.fromCountry`, so the
  // OFFERER is the one who leaves the war. Barring `to` would refuse an attacker's
  // surrender to an ally, which is exactly the deal that should be allowed.
  //
  // Reported ahead of the indemnity rules below because it is the durable bar of the two:
  // a player refused here needs to be told about the treaty, not about the money.
  //
  // ANY entry binding this country, not merely the first: `resolveTreatyDefenders`
  // excludes anyone already rostered, so today a country holds at most one entry per
  // conflict — but a `find` would silently release the bar on the wrong obligation if
  // that ever stopped holding, and the invariant is not enforced here.
  const bound = conflict.treatyEntries?.find(
    // A live roster read, never a stored flag, so the bar lifts by itself the moment the
    // defended member takes its own peace.
    (e) => e.countryId === from && rosters.includes(e.defending)
  );
  if (bound) {
    const org =
      INTERNATIONAL_ORGANIZATIONS[bound.organizationId as keyof typeof INTERNATIONAL_ORGANIZATIONS]
        ?.name ?? bound.organizationId;
    const fromName = COUNTRY_CONFIGS[from]?.name ?? from;
    const defendedName = COUNTRY_CONFIGS[bound.defending]?.name ?? bound.defending;
    return {
      ok: false,
      error: `${fromName} entered this war under the ${org}. It cannot make a separate peace while ${defendedName} is still fighting.`,
    };
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
  });
}
