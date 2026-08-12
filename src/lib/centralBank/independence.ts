/**
 * B5 — the independence fight.
 *
 * B4 gave scrutiny economic teeth and made ONE political act expensive: setting
 * the rate from the finance seat instead of the bank (`INTERFERENCE_SCRUTINY`).
 * The other two ways a government takes a central bank were still free.
 *
 *  - **Dismissing the chair.** There was no dismissal path at all: a chair could
 *    resign, or a term could expire, and both took the ordinary
 *    `CHAIR_CHANGE_SCRUTINY_RETAINED` haircut. Adding a dismissal that took the
 *    same haircut would have handed the government the laundromat B4 closed —
 *    fire the chair, keep 75%, repeat. So a dismissal keeps ALL of the
 *    institution's scrutiny and adds more on top. Firing the chair is strictly
 *    worse than waiting them out, which is the point.
 *  - **Revoking independence by statute.** `applyCentralBankIndependenceProvision`
 *    flipped `governmentControlled` and posted a news item. Nothing else. The
 *    statute is already expensive in the legislature — it needs votes — but the
 *    thing it buys, a bank that does what the government says, arrived at no
 *    cost to what that bank's word is worth.
 *
 * Granting independence deliberately pays NOTHING back. If it did, grant-revoke
 * cycling would be a laundromat with extra steps. The only way out of scrutiny
 * stays the one B4 built: hold a correct stance and let resolve mature.
 */

import type { CentralBank } from "@/lib/db/types/centralBank";

/**
 * Scrutiny added when the executive dismisses a sitting chair before their term
 * ends. Larger than `INTERFERENCE_SCRUTINY` (12): overriding one rate decision
 * is a disagreement, removing the person who makes them is a statement about
 * who the bank answers to.
 */
export const DISMISSAL_SCRUTINY = 18;

/**
 * Scrutiny added when a statute revokes the bank's operational independence.
 * Larger again: a law outlasts the government that passed it.
 */
export const REVOCATION_SCRUTINY = 22;

/**
 * Scrutiny after a dismissal.
 *
 * Note what is NOT here: the `CHAIR_CHANGE_SCRUTINY_RETAINED` multiplier that
 * every other vacancy path applies. A dismissal must never be a cheaper way to
 * shed scrutiny than letting a term run out, so the institution keeps the lot
 * and takes the penalty on top.
 */
export function scrutinyAfterDismissal(bank: Pick<CentralBank, "chairInfamy">): number {
  const current = Math.max(0, Math.min(100, bank.chairInfamy ?? 0));
  return Math.min(100, current + DISMISSAL_SCRUTINY);
}

/** Scrutiny after a statutory revocation of independence. */
export function scrutinyAfterRevocation(bank: Pick<CentralBank, "chairInfamy">): number {
  const current = Math.max(0, Math.min(100, bank.chairInfamy ?? 0));
  return Math.min(100, current + REVOCATION_SCRUTINY);
}

/**
 * The three ways a government can take a bank, and what each costs it, for the
 * UI. Published as data so the card and the wiki cannot drift from the engine.
 */
export const INDEPENDENCE_COSTS: ReadonlyArray<{
  action: string;
  scrutiny: number;
  note: string;
}> = [
  {
    action: "Set the rate directly",
    scrutiny: 12,
    note: "Available only while the bank is government-controlled.",
  },
  {
    action: "Dismiss the chair",
    scrutiny: DISMISSAL_SCRUTINY,
    note: "The institution keeps all of its existing scrutiny — unlike a resignation or an expired term.",
  },
  {
    action: "Revoke independence by statute",
    scrutiny: REVOCATION_SCRUTINY,
    note: "Needs the votes. Granting independence back refunds nothing.",
  },
];
