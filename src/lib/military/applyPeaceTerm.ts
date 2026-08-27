import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget } from "@/lib/db/types";
import { convertLocal } from "@/lib/internationalOrganizations/organizationFund";
import { loadWorldPreset } from "@/lib/currency/gdpAnchorRate";
import { ensureFederalBudget } from "@/lib/turn/ensureFederalBudget";
import { recordProcurementRestriction } from "@/lib/db/collections/procurementRestrictions";
import type { PeaceTerm } from "./peaceTerm";

export interface ApplyTermContext {
  /** The country imposing or offering. Receives an indemnity it is not paying. */
  imposer: CountryId;
  /** The country the term lands on. */
  target: CountryId;
  conflictId: string;
  currentTurn: number;
}

/**
 * Apply one settlement term to the world.
 *
 * Called from BOTH roads: the impose route on a war won outright, and
 * `acceptPeace` on a negotiated deal. That is the whole point of the function.
 * Winning outright and negotiating do the same thing to the world, so they are the
 * same code, and the two cannot drift on what a term means.
 *
 * NOT REPLAYABLE. Every caller must claim its document before entering, exactly as
 * `acceptPeace` claims the offer on `status: "pending"` before moving any money.
 *
 * Spec: docs/superpowers/specs/2026-08-27-peace-terms-design.md
 */
export async function applyPeaceTerm(
  db: Db,
  term: PeaceTerm,
  ctx: ApplyTermContext
): Promise<void> {
  if (term.kind === "indemnity") {
    await moveIndemnity(db, term, ctx);
    return;
  }
  if (term.kind === "demilitarisation") {
    // The bar lands on the TARGET. The imposer is the one taking the term, not the
    // one bound by it.
    await recordProcurementRestriction(
      db,
      ctx.target,
      ctx.currentTurn + term.turns,
      ctx.conflictId
    );
    return;
  }

  // The remaining branch lands in a later task. Throwing rather than silently
  // doing nothing: a settlement that reports success and changes nothing is worse
  // than one that fails loudly, because the war resolves either way.
  throw new Error(`applyPeaceTerm: unsupported term ${term.kind}`);
}

/**
 * Move the indemnity, once.
 *
 * The amount is quoted in the PAYER's local currency, so it is debited as quoted
 * and CONVERTED before it is credited: every treasury is denominated locally, and
 * moving the raw number would invent or destroy value at the exchange rate.
 * `convertLocal` is a no-op for a same-currency pair, so it is called
 * unconditionally rather than guarded; guarding is how a double conversion gets
 * written.
 *
 * `$inc` on `treasuryBalance` only. `debt.principal` is a DERIVED mirror
 * (`max(0, -treasuryBalance)`) that `treasuryTurn` owns; writing both would create
 * two sources of truth.
 *
 * No affordability check. A payment may push the payer negative, which is what
 * national debt is: requiring a surplus would mean a country already in debt could
 * never buy peace, which is most of the countries that would want to.
 */
async function moveIndemnity(
  db: Db,
  term: Extract<PeaceTerm, { kind: "indemnity" }>,
  ctx: ApplyTermContext
): Promise<void> {
  const { payer, amount } = term;
  if (!(amount > 0)) return; // A white peace moves no money at all.

  const recipient: CountryId = payer === ctx.target ? ctx.imposer : ctx.target;
  const preset = await loadWorldPreset(db);
  const credited = convertLocal(payer, recipient, amount, preset);
  const now = new Date();

  // Both non-upserting `updateOne`s below match by countryId. If either party has
  // no federalBudget doc (the partial-seed gap `ensureFederalBudget` exists to
  // close), its write matches zero documents and the indemnity silently vanishes
  // on that side. Heal both first so both writes land.
  await ensureFederalBudget(db, payer, preset);
  await ensureFederalBudget(db, recipient, preset);

  const budgets = db.collection<FederalBudget>("federalBudget");
  await budgets.updateOne(
    { countryId: payer },
    { $inc: { treasuryBalance: -amount }, $set: { updatedAt: now } }
  );
  await budgets.updateOne(
    { countryId: recipient },
    { $inc: { treasuryBalance: credited }, $set: { updatedAt: now } }
  );
}
