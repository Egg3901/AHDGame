import type { Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { FederalBudget, Union } from "@/lib/db/types";
import type { UnionLawProvision } from "@/lib/db/types/legislation";
import { getNationalBudgetId } from "@/lib/bonds/sovereign";

/** Bounds enforced on the bias axis regardless of what a bill's raw input claims. */
export const UNION_LAW_BIAS_MIN = -50;
export const UNION_LAW_BIAS_MAX = 50;

/** Player-facing message every union/union-busting mutation returns while a country's unions are banned. */
export const UNIONS_BANNED_MESSAGE = "Unions are banned under current law.";

export function clampUnionLawBias(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(UNION_LAW_BIAS_MIN, Math.min(UNION_LAW_BIAS_MAX, value));
}

/**
 * True when `value` is a valid `UnionLawProvision.banAction`. Shared by the
 * bill-proposal validators (`billProposal.ts`, `api/congress/bills`) so the
 * accepted set can never drift between the two copies.
 */
export function isUnionLawBanAction(value: unknown): value is "ban" | "repeal_ban" {
  return value === "ban" || value === "repeal_ban";
}

/**
 * Union ban (player suggestion #93): is this country currently under an
 * enacted union ban? Reads `FederalBudget.unionsBanned` — the single source
 * of truth written by `applyUnionLawProvision`. Used as the 403 gate by
 * every player union mutation (`src/lib/unions/commands/**`) and the
 * union-busting attempt (busting is moot while unions are outlawed).
 */
export async function isUnionsBanned(db: Db, countryId: CountryId): Promise<boolean> {
  const budget = await db
    .collection<FederalBudget>("federalBudget")
    .findOne({ _id: getNationalBudgetId(countryId) }, { projection: { unionsBanned: 1 } });
  return budget?.unionsBanned === true;
}

/**
 * v3 Phase 7b: apply an enacted `UnionLawProvision` to the country's
 * `FederalBudget.unionLawBias`. Modeled on `applyTariffProvision`'s
 * economy-wide sync (`src/lib/tariffs/tariffEffects.ts`) — a simple field
 * write, no revenue recompute needed (unlike tariffs, union-law bias doesn't
 * feed the budget's own revenue projection).
 *
 * Union ban (player suggestion #93): when `provision.banAction` is present
 * the provision is a ban/repeal action instead of a bias law —
 *  - `"ban"` sets `unionsBanned: true` and suspends every player `Union` in
 *    the country (`suspended: true`; docs are never deleted, so a repeal
 *    restores leadership/treasury/pressure intact).
 *  - `"repeal_ban"` clears both flags; NPC unionization drift resumes from
 *    wherever the ban-decay left it.
 * A ban action deliberately does NOT touch `unionLawBias`, so the pre-ban
 * bias regime survives an enact→repeal round-trip.
 *
 * Called from `legislationEffects.ts`'s dispatch — MUST be reached via its
 * own `else if (p.type === "union_law")` branch, not the trailing tariff
 * catch-all (see the comment at that call site).
 */
export async function applyUnionLawProvision(
  db: Db,
  countryId: CountryId,
  provision: UnionLawProvision
): Promise<void> {
  const budgetId = getNationalBudgetId(countryId);
  const now = new Date();

  if (provision.banAction === "ban" || provision.banAction === "repeal_ban") {
    const banned = provision.banAction === "ban";
    await db
      .collection<FederalBudget>("federalBudget")
      .updateOne({ _id: budgetId }, { $set: { unionsBanned: banned, updatedAt: now } });
    await db
      .collection<Union>("unions")
      .updateMany({ countryId }, { $set: { suspended: banned, updatedAt: now } });
    return;
  }

  const bias = clampUnionLawBias(provision.bias);
  await db
    .collection<FederalBudget>("federalBudget")
    .updateOne({ _id: budgetId }, { $set: { unionLawBias: bias, updatedAt: now } });
}
